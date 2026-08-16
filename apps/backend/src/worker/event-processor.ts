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
import type { PostService } from "../posts/post-service.js";
import type { ThreadService } from "../posts/thread-service.js";
import type { ScheduledEvent } from "../scheduled-events/scheduled-event.js";
import type { SimulationRepository } from "../simulation/simulation-repository.js";
import { resolveActionTargets, selectAction } from "../simulation/action-selector.js";
import { selectResponders } from "../simulation/responder-selector.js";
import type { WorkerLogger } from "./logger.js";

export type EventProcessorDeps = {
  simulations: SimulationRepository;
  characters: CharacterRepository;
  posts: PostService;
  threads: ThreadService;
  agents: AgentService;
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
    case "character.join.welcome":
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
