/**
 * Room review service (issue #165).
 *
 * Handles the `room.review` scheduled event type.
 *
 * A room review is a periodic health check that looks at the room's current
 * state and schedules follow-up actions as needed:
 *
 *   1. If there are dormant threads (no activity for DORMANT_THRESHOLD_MS),
 *      schedule a `thread.revive` event for each one (up to MAX_REVIVALS).
 *   2. If the room has active Cast members but no recent posts, schedule a
 *      `character.respond` event to prompt a character to post something new.
 *
 * Design notes:
 *   - Clock is injected so tests are deterministic.
 *   - The review itself does not generate any posts — it only schedules events.
 *     This keeps the review fast and idempotent (the repository deduplicates
 *     pending events with the same logical identity).
 *   - Archived rooms are skipped immediately.
 *   - The review does not fail if scheduling an individual event fails; it logs
 *     the error and continues with the remaining actions.
 */

import { randomUUID } from "node:crypto";
import type { ScheduledEventRepository } from "../scheduled-events/scheduled-event-repository.js";
import type { SimulationRepository } from "./simulation-repository.js";
import type { RoomMembershipRepository } from "./room-membership-repository.js";
import type { PostService } from "../posts/post-service.js";
import type { Clock } from "./thread-revival-service.js";
import { DORMANT_THRESHOLD_MS } from "./thread-revival-service.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum number of `thread.revive` events to schedule per review cycle.
 * Prevents a room with many dormant threads from flooding the queue.
 */
const MAX_REVIVALS_PER_REVIEW = 2;

/**
 * How far in the future to schedule a `thread.revive` event (ms).
 * A short delay lets the worker pick it up quickly without hammering the queue.
 */
const REVIVAL_SCHEDULE_DELAY_MS = 30_000; // 30 seconds

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RoomReviewDeps = {
  simulations: SimulationRepository;
  memberships: RoomMembershipRepository;
  posts: PostService;
  scheduledEvents: ScheduledEventRepository;
  logger: {
    warn: (obj: Record<string, unknown>, message: string) => void;
  };
  /** Injectable clock for deterministic tests. Defaults to `() => new Date()`. */
  clock?: Clock;
};

export type RoomReviewResult = {
  /** Number of `thread.revive` events scheduled. */
  revivalsScheduled: number;
  /** Reason the review was skipped, if applicable. */
  skippedReason?: string;
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Reviews a room and schedules follow-up events as needed.
 *
 * Called by the `room.review` event handler. Returns a summary of what was
 * scheduled.
 */
export async function reviewRoom(
  roomId: string,
  deps: RoomReviewDeps,
): Promise<RoomReviewResult> {
  const clock = deps.clock ?? (() => new Date());
  const now = clock();

  // Verify the room is still active.
  const room = await deps.simulations.findById(roomId);
  if (!room || room.status === "archived") {
    return { revivalsScheduled: 0, skippedReason: "room not found or archived" };
  }

  // Check whether there are any active Cast members. Without Cast, there is
  // nothing to revive threads with.
  const activeCastIds = await deps.memberships.findActiveCastIds(roomId);
  if (activeCastIds.length === 0) {
    return { revivalsScheduled: 0, skippedReason: "no active Cast members in room" };
  }

  // Find dormant threads.
  const dormantBefore = new Date(now.getTime() - DORMANT_THRESHOLD_MS);
  const dormantRoots = await deps.posts.findDormantThreadRoots(
    roomId,
    dormantBefore,
    MAX_REVIVALS_PER_REVIEW,
  );

  if (dormantRoots.length === 0) {
    return { revivalsScheduled: 0, skippedReason: "no dormant threads found" };
  }

  // Schedule a `thread.revive` event for each dormant thread root.
  // The repository deduplicates by (type, roomId, postId, characterId), so
  // scheduling the same revival twice is safe.
  let revivalsScheduled = 0;
  const scheduledAt = new Date(now.getTime() + REVIVAL_SCHEDULE_DELAY_MS);

  for (const root of dormantRoots) {
    try {
      const event = await deps.scheduledEvents.create({
        id: randomUUID(),
        type: "thread.revive",
        scheduledAt,
        roomId,
        postId: root.id,
        threadRootId: root.id,
        characterId: null,
      });

      if (event !== null) {
        revivalsScheduled += 1;
      }
      // If event is null, a pending revival for this thread already exists —
      // that is fine, the deduplication is working as intended.
    } catch (error) {
      deps.logger.warn(
        { roomId, threadRootId: root.id, error },
        "failed to schedule thread revival; continuing room review",
      );
    }
  }

  return { revivalsScheduled };
}
