import type { FeedThreadDto, ResponseOutcome, SseEvent } from "@brickr/shared";
import { toFeedCapabilities } from "../feed/feed-capabilities.js";
import type { FeedRoom } from "../feed/feed-repository.js";
import type { FeedReader } from "../feed/feed-service.js";
import { isGlobalSimulation } from "./simulation.js";
import { isSimulationOwnerOrAdmin } from "./simulation-service.js";

/**
 * A post landed and its thread was rebuilt.
 *
 * `room` travels with the thread because `capabilities` are the one part of the
 * DTO that depends on who is reading: the thread itself is built once, and each
 * subscriber's capabilities are derived from it at the moment of delivery.
 */
export type ThreadActivityEvent = {
  type: "thread.activity";
  simulationId: string;
  room: FeedRoom;
  /** Capabilities as an anonymous reader would see them; recomputed per subscriber. */
  thread: FeedThreadDto;
};

export type ResponseStartedInternalEvent = {
  type: "response.started";
  simulationId: string;
  activityId: string;
  targetPostId: string;
  threadRootId: string;
};

export type ResponseFinishedInternalEvent = {
  type: "response.finished";
  simulationId: string;
  activityId: string;
  targetPostId: string;
  threadRootId: string;
  outcome: ResponseOutcome;
};

/**
 * A whole round of responses ended. Never leaves the process.
 *
 * A client has no use for it — the response pairs already say what is in flight —
 * but the backend does: it is where a run's outcome can be observed without
 * publishing anything, and what the service tests wait on.
 */
export type GenerationCompletedEvent = {
  type: "generation.completed";
  simulationId: string;
  triggerPostId: string;
  generatedPostIds: string[];
};

/**
 * A run could not proceed. Internal for the same reason as its reason string:
 * "provider X rate limited" describes the machinery behind a post and would say
 * out loud that the author is an AI (§11.2). Users see the aggregate instead.
 */
export type GenerationFailedEvent = {
  type: "generation.failed";
  simulationId: string;
  reason: string;
};

export type InternalSseEvent =
  | ThreadActivityEvent
  | ResponseStartedInternalEvent
  | ResponseFinishedInternalEvent
  | GenerationCompletedEvent
  | GenerationFailedEvent;

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
