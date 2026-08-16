/**
 * Event processor: maps a claimed ScheduledEvent to the domain action it
 * represents and executes it.
 *
 * Each handler is responsible for one event type. Unknown types are logged and
 * skipped (treated as completed) so a schema migration that adds a new type
 * does not crash older worker replicas.
 *
 * Design note: the worker intentionally does not import SimulationService
 * directly — that class owns the in-process SSE hub and the "stopped" set,
 * neither of which makes sense in a separate process. Instead the worker calls
 * the same lower-level building blocks (repositories, AgentService) that
 * SimulationService uses, but without the SSE layer. SSE is a real-time
 * concern for the API process; the worker's job is durable execution.
 */

import type { AgentService } from "../agents/agent-service.js";
import type { CharacterRepository } from "../characters/character-repository.js";
import type { LLMClient } from "../llm/llm-client.js";
import type { LLMProviderRegistry } from "../llm/provider-registry.js";
import type { PostService } from "../posts/post-service.js";
import type { ThreadService } from "../posts/thread-service.js";
import type { ScheduledEvent } from "../scheduled-events/scheduled-event.js";
import type { SimulationRepository } from "../simulation/simulation-repository.js";
import type { RoomMembershipRepository } from "../simulation/room-membership-repository.js";
import { resolveActionTargets, selectAction } from "../simulation/action-selector.js";
import { selectResponders } from "../simulation/responder-selector.js";
import {
  processCastJoinRequests,
  publishWelcomePost,
} from "../simulation/cast-join-service.js";
import type { WorkerLogger } from "./logger.js";

export type EventProcessorDeps = {
  simulations: SimulationRepository;
  characters: CharacterRepository;
  memberships: RoomMembershipRepository;
  posts: PostService;
  threads: ThreadService;
  agents: AgentService;
  llm: LLMClient;
  providers: LLMProviderRegistry;
  logger: WorkerLogger;
};

/**
 * Processes one claimed event. Returns normally on success; throws on failure
 * so the caller can apply retry logic.
 *
 * The function is intentionally stateless: it reads everything it needs from
 * the database on each invocation so that retried events always see the latest
 * state.
 */
export async function processEvent(
  event: ScheduledEvent,
  deps: EventProcessorDeps,
): Promise<void> {
  deps.logger.info({ eventId: event.id, type: event.type }, "processing event");

  switch (event.type) {
    case "character.respond":
      await handleCharacterRespond(event, deps);
      break;

    case "character.join.request":
      await handleCharacterJoinRequest(event, deps);
      break;

    case "character.join.welcome":
      await handleCharacterJoinWelcome(event, deps);
      break;

    case "thread.revive":
    case "room.review":
    case "room.analysis.refresh":
      // These event types are defined in the schema but not yet implemented.
      // Log and treat as a no-op so they do not block the queue.
      deps.logger.info(
        { eventId: event.id, type: event.type },
        "event type not yet implemented — skipping",
      );
      break;

    default: {
      // Unknown type: a newer schema version added it. Skip gracefully.
      const unknownType: string = (event as { type: string }).type;
      deps.logger.warn(
        { eventId: event.id, type: unknownType },
        "unknown event type — skipping",
      );
      break;
    }
  }
}

/**
 * Handles a `character.respond` event.
 *
 * Loads the triggering post and the room's character cast, selects which
 * characters should respond, generates their posts, and persists them.
 *
 * Mirrors the core of SimulationService.runGeneration / processCharacter but
 * without the SSE layer (the worker has no connected clients).
 */
async function handleCharacterRespond(
  event: ScheduledEvent,
  deps: EventProcessorDeps,
): Promise<void> {
  const { postId, roomId, characterId } = event;

  if (!postId || !roomId) {
    throw new Error(
      `character.respond event ${event.id} is missing postId or roomId`,
    );
  }

  // Load the triggering post.
  const triggerPost = await deps.posts.findById(postId);
  if (!triggerPost) {
    // The post was deleted after the event was scheduled. Treat as a no-op.
    deps.logger.info(
      { eventId: event.id, postId },
      "trigger post no longer exists — skipping",
    );
    return;
  }

  // Verify the persisted room state is still active. `archived` is the only
  // persisted stopped state; SimulationService's in-memory set merely aborts
  // API-process generation already in flight while that archive write occurs.
  // A worker always reloads the row, so it neither needs nor can share that set.
  const simulation = await deps.simulations.findById(roomId);
  if (!simulation || simulation.status === "archived") {
    deps.logger.info(
      { eventId: event.id, roomId },
      "room is archived or deleted — skipping",
    );
    return;
  }

  // Load all characters for responder selection.
  const allCharacters = await deps.characters.findAll();

  // If a specific character is targeted, use only that one; otherwise select
  // responders the same way the simulation service does.
  const explicitIds = characterId ? [characterId] : [];

  const { all: responders } = selectResponders({
    characters: allCharacters,
    mentionedHandles: triggerPost.mentions,
    explicitIds,
    excludeIds: [triggerPost.authorId],
    // Worker uses the same defaults as the API; these could be made
    // configurable via env vars in a follow-up.
    minResponders: 1,
    maxResponders: characterId ? 1 : 6,
  });

  if (responders.length === 0) {
    deps.logger.info({ eventId: event.id }, "no responders selected — skipping");
    return;
  }

  // Load the thread context once; each character reads the same snapshot.
  const thread = await deps.threads.getCurrentThread(triggerPost.id);
  if (!thread) {
    deps.logger.info(
      { eventId: event.id, postId },
      "thread context unavailable — skipping",
    );
    return;
  }

  // Resolve handles for the transcript.
  const users = await deps.posts.findUsersByIds(
    [thread.target, ...thread.posts].map((p) => p.authorId),
  );
  const byId = new Map<string, string>([
    ...allCharacters.map((c) => [c.id, c.handle] as const),
    ...users.map((u) => [u.id, u.handle] as const),
  ]);
  const resolveHandle = (authorId: string): string => byId.get(authorId) ?? authorId;

  // Generate and persist each character's response sequentially.
  // The worker does not need the concurrency limiter the API uses because
  // multiple worker replicas already provide parallelism at the process level.
  let successCount = 0;
  for (const character of responders) {
    try {
      const action = selectAction({
        character,
        target: thread.target,
        threadPosts: thread.posts,
      });

      const generated = await deps.agents.generate({
        character,
        target: thread.target,
        posts: thread.posts,
        action,
        resolveHandle,
      });

      const { replyTo, quoteOf } = resolveActionTargets(action, thread.target);

      await deps.posts.publish({
        simulationId: roomId,
        authorId: character.id,
        content: generated.content,
        replyTo,
        quoteOf,
      });
      successCount += 1;

      deps.logger.info(
        {
          eventId: event.id,
          characterId: character.id,
          action,
          providerId: generated.providerId,
          model: generated.model,
        },
        "character posted via worker",
      );
    } catch (error) {
      // One character failing must not prevent others from responding.
      deps.logger.warn(
        {
          eventId: event.id,
          characterId: character.id,
          err: error instanceof Error ? error.message : String(error),
        },
        "character generation failed in worker",
      );
    }
  }

  if (successCount === 0) {
    throw new Error(`all ${String(responders.length)} responders failed for event ${event.id}`);
  }
}

/**
 * Handles a `character.join.request` event.
 *
 * Selects Cast candidates for the room, runs LLM judgment, and creates
 * membership records according to the room's visibility rules.
 *
 * This is a best-effort operation: individual candidate failures are logged but
 * do not cause the event to fail (which would trigger a retry).
 */
async function handleCharacterJoinRequest(
  event: ScheduledEvent,
  deps: EventProcessorDeps,
): Promise<void> {
  const { roomId } = event;

  if (!roomId) {
    throw new Error(`character.join.request event ${event.id} is missing roomId`);
  }

  const results = await processCastJoinRequests(roomId, {
    simulations: deps.simulations,
    characters: deps.characters,
    memberships: deps.memberships,
    posts: deps.posts,
    llm: deps.llm,
    providers: deps.providers,
  });

  for (const result of results) {
    if (result.outcome === "joined" || result.outcome === "pending") {
      deps.logger.info(
        { eventId: event.id, roomId, characterId: result.characterId, outcome: result.outcome },
        "cast join processed",
      );
    } else {
      deps.logger.info(
        { eventId: event.id, roomId, outcome: result.outcome, reason: result.reason },
        "cast join skipped or errored",
      );
    }
  }
}

/**
 * Handles a `character.join.welcome` event.
 *
 * Publishes a welcome post from the Cast character that has just become an
 * active member of the room. Failure is non-fatal: the membership is already
 * committed, so a failed welcome post does not need to be retried.
 */
async function handleCharacterJoinWelcome(
  event: ScheduledEvent,
  deps: EventProcessorDeps,
): Promise<void> {
  const { roomId, characterId } = event;

  if (!roomId || !characterId) {
    throw new Error(
      `character.join.welcome event ${event.id} is missing roomId or characterId`,
    );
  }

  await publishWelcomePost(roomId, characterId, {
    simulations: deps.simulations,
    characters: deps.characters,
    posts: deps.posts,
    llm: deps.llm,
    providers: deps.providers,
  });

  deps.logger.info(
    { eventId: event.id, roomId, characterId },
    "cast welcome post published",
  );
}
