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
import type { ScheduledEventRepository } from "../scheduled-events/scheduled-event-repository.js";
import type { ScheduledEvent } from "../scheduled-events/scheduled-event.js";
import type { SimulationRepository } from "../simulation/simulation-repository.js";
import type { RoomMembershipRepository } from "../simulation/room-membership-repository.js";
import type { CastParticipationResolver } from "../simulation/cast-participation-resolver.js";
import { resolveActionTargets, selectAction } from "../simulation/action-selector.js";
import { selectResponders } from "../simulation/responder-selector.js";
import {
  processCastJoinRequests,
  publishWelcomePost,
} from "../simulation/cast-join-service.js";
import { reviveThread } from "../simulation/thread-revival-service.js";
import { reviewRoom } from "../simulation/room-review-service.js";
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
  scheduledEvents: ScheduledEventRepository;
  /** Resolves which Cast characters are eligible to respond in a given room (issue #177). */
  castResolver: CastParticipationResolver;
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
      await handleThreadRevive(event, deps);
      break;

    case "room.review":
      await handleRoomReview(event, deps);
      break;

    case "room.analysis.refresh":
      // Not yet implemented. Log and treat as a no-op so it does not block the queue.
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

  // Resolve the eligible Cast for this room: all active Casts for the Feed
  // room, or only active-membership Casts for a regular room (issue #177).
  const eligibleCharacters = await deps.castResolver.resolveRespondingCasts({
    roomId,
    roomScope: simulation.scope,
  });

  // If a specific character is targeted, use only that one; otherwise select
  // responders the same way the simulation service does.
  const explicitIds = characterId ? [characterId] : [];

  const { all: responders } = selectResponders({
    characters: eligibleCharacters,
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

  // Eligibility and transcript identity are separate concerns. Include
  // non-Cast/previous Cast authors so old posts still resolve their handles.
  const allCharacters = await deps.characters.findAll();

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
        roomId,
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
    } else if (result.outcome === "error") {
      deps.logger.warn(
        { eventId: event.id, roomId, reason: result.reason },
        "cast join errored",
      );
    } else {
      deps.logger.info(
        { eventId: event.id, roomId, reason: result.reason },
        "cast join skipped",
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

  const result = await publishWelcomePost(roomId, characterId, {
    simulations: deps.simulations,
    characters: deps.characters,
    posts: deps.posts,
    llm: deps.llm,
    providers: deps.providers,
  });

  if (result.outcome === "published") {
    deps.logger.info(
      { eventId: event.id, roomId, characterId },
      "cast welcome post published",
    );
  } else if (result.outcome === "error") {
    deps.logger.warn(
      { eventId: event.id, roomId, characterId, reason: result.reason },
      "cast welcome post errored",
    );
  } else {
    deps.logger.info(
      { eventId: event.id, roomId, characterId, reason: result.reason },
      "cast welcome post skipped",
    );
  }
}

/**
 * Handles a `thread.revive` event.
 *
 * Selects a dormant thread in the room and has a willing Cast character post
 * to it, restarting the conversation. The target thread root is taken from
 * `event.postId` when present (scheduled by `room.review`), or the service
 * picks the most recently dormant thread in the room.
 *
 * Failure is non-fatal: if no dormant thread or no willing character is found,
 * the event is treated as a no-op rather than a retry-worthy failure.
 */
async function handleThreadRevive(
  event: ScheduledEvent,
  deps: EventProcessorDeps,
): Promise<void> {
  const { roomId } = event;

  if (!roomId) {
    throw new Error(`thread.revive event ${event.id} is missing roomId`);
  }

  const result = await reviveThread(roomId, {
    simulations: deps.simulations,
    characters: deps.characters,
    posts: deps.posts,
    threads: deps.threads,
    agents: deps.agents,
    castResolver: deps.castResolver,
    targetPostId: event.postId ?? event.threadRootId ?? undefined,
  });

  if (result.outcome === "revived") {
    deps.logger.info(
      { eventId: event.id, roomId, characterId: result.characterId, postId: result.postId },
      "thread revived",
    );
  } else if (result.outcome === "error") {
    // Throw so the worker applies retry logic.
    throw new Error(`thread.revive failed for event ${event.id}: ${result.reason}`);
  } else {
    deps.logger.info(
      { eventId: event.id, roomId, reason: result.reason },
      "thread revival skipped",
    );
  }
}

/**
 * Handles a `room.review` event.
 *
 * Inspects the room's current state and schedules follow-up events:
 *   - `thread.revive` for each dormant thread (up to a per-review limit).
 *
 * The review itself does not generate any posts. It is a lightweight
 * scheduling pass that delegates actual work to subsequent events.
 *
 * Failure is non-fatal: if the room is archived or has no Cast, the event
 * is treated as a no-op.
 */
async function handleRoomReview(
  event: ScheduledEvent,
  deps: EventProcessorDeps,
): Promise<void> {
  const { roomId } = event;

  if (!roomId) {
    throw new Error(`room.review event ${event.id} is missing roomId`);
  }

  const result = await reviewRoom(roomId, {
    simulations: deps.simulations,
    posts: deps.posts,
    scheduledEvents: deps.scheduledEvents,
    castResolver: deps.castResolver,
    logger: deps.logger,
  });

  if (result.skippedReason) {
    deps.logger.info(
      { eventId: event.id, roomId, reason: result.skippedReason },
      "room review skipped",
    );
  } else {
    deps.logger.info(
      { eventId: event.id, roomId, revivalsScheduled: result.revivalsScheduled },
      "room review completed",
    );
  }
}
