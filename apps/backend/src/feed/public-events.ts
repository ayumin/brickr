import type { SseEvent } from "@brickr/shared";
import { isGlobalSimulation } from "../simulation/simulation.js";
import { isSimulationOwnerOrAdmin } from "../simulation/simulation-service.js";
import type { InternalSseEvent } from "../simulation/public-events.js";
import { toFeedCapabilities } from "./feed-capabilities.js";
import type { FeedReader } from "./feed-service.js";

/**
 * The one place an internal event becomes something a subscriber may see (§11.4).
 *
 * Two things happen here and nowhere else:
 *
 * - Internal-only events return `null` and are dropped. A new event type is
 *   therefore invisible until somebody deliberately maps it, rather than leaking
 *   by default.
 * - `capabilities` are computed for *this* subscriber. Everything else in the
 *   payload is identical for everyone, because the feed is a surface that looks
 *   the same for all readers (§10.1) — a stopped room's thread arrives with the
 *   same content whether or not you own it.
 *
 * Character identity never reaches this function: the service publishes an
 * `activityId` instead of a character, so there is nothing here to strip. Details
 * worth investigating stay in the backend log.
 */
export function toPublicEvent(event: InternalSseEvent, reader: FeedReader): SseEvent | null {
  switch (event.type) {
    case "thread.activity":
      return {
        type: "feed.post-created",
        thread: {
          ...event.thread,
          capabilities: toFeedCapabilities({
            isSignedIn: reader !== null,
            isFeedRoom: isGlobalSimulation(event.room),
            isStoppedRoom: event.room.status === "stopped",
            isRoomOwnerOrAdmin: reader !== null && isSimulationOwnerOrAdmin(event.room, reader),
            replyCount: event.thread.replyCount,
            previewedReplyCount: event.thread.latestReplies.length,
          }),
        },
      };

    case "response.started":
      return {
        type: "response.started",
        activityId: event.activityId,
        simulationId: event.simulationId,
        targetPostId: event.targetPostId,
        threadRootId: event.threadRootId,
      };

    case "response.finished":
      return {
        type: "response.finished",
        activityId: event.activityId,
        simulationId: event.simulationId,
        targetPostId: event.targetPostId,
        threadRootId: event.threadRootId,
        outcome: event.outcome,
      };

    default:
      return null;
  }
}
