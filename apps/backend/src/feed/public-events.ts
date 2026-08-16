import type { FeedThreadDto, SseEvent } from "@brickr/shared";
import { isGlobalSimulation } from "../simulation/simulation.js";
import { isSimulationOwnerOrAdmin } from "../simulation/simulation-service.js";
import type { PublishedInternalSseEvent } from "../simulation/public-events.js";
import { toFeedCapabilities } from "./feed-capabilities.js";
import type { FeedRoom } from "./feed-repository.js";
import type { FeedReader } from "./feed-service.js";

/**
 * One thread, with `capabilities` answered for this reader.
 *
 * Shared by the event stream and by the create-post response so both describe the
 * same thread the same way. Computing it twice is how the two would start
 * disagreeing about whether a stopped room accepts a reply.
 *
 * Everything except `capabilities` is identical for everyone: the feed is a
 * surface that looks the same for all readers (§10.1).
 */
export function withReaderCapabilities(
  thread: FeedThreadDto,
  room: FeedRoom,
  reader: FeedReader,
): FeedThreadDto {
  return {
    ...thread,
    capabilities: toFeedCapabilities({
      isSignedIn: reader !== null,
      isFeedRoom: isGlobalSimulation(room),
      isStoppedRoom: room.status === "archived",
      isRoomOwnerOrAdmin: reader !== null && isSimulationOwnerOrAdmin(room, reader),
      replyCount: thread.replyCount,
      previewedReplyCount: thread.latestReplies.length,
    }),
  };
}

/**
 * The one place an internal event becomes something a subscriber may see (§11.4).
 *
 * Two things happen here and nowhere else:
 *
 * - Internal-only events return `null` and are dropped. A new event type is
 *   therefore invisible until somebody deliberately maps it, rather than leaking
 *   by default.
 * - Public events contain identifiers and minimal transient state only. DTOs,
 *   content and per-reader capabilities remain authoritative in REST responses.
 *
 * Character identity never reaches this function: the service publishes an
 * `activityId` instead of a character, so there is nothing here to strip. Details
 * worth investigating stay in the backend log.
 */
export function toPublicEvent(event: PublishedInternalSseEvent): SseEvent | null {
  const metadata = {
    eventId: event.eventId,
    roomId: event.simulationId,
    timestamp: event.timestamp,
  };

  switch (event.type) {
    case "thread.activity":
      return {
        ...metadata,
        type: "post.created",
        postId: event.postId,
        threadRootId: event.thread.root.id,
      };

    case "response.started":
      return {
        ...metadata,
        type: "response.started",
        activityId: event.activityId,
        targetPostId: event.targetPostId,
        threadRootId: event.threadRootId,
      };

    case "response.finished":
      return {
        ...metadata,
        type: "response.finished",
        activityId: event.activityId,
        targetPostId: event.targetPostId,
        threadRootId: event.threadRootId,
        outcome: event.outcome,
      };

    default:
      return null;
  }
}
