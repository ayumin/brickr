import type { FeedThreadDto, ResponseOutcome } from "@brickr/shared";
import type { FeedRoom } from "../feed/feed-repository.js";

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
  postId: string;
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
 * Every response caused by one submission has finished. Never leaves the process.
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

/** Metadata assigned once by EventHub and shared by every subscriber. */
export type PublishedInternalSseEvent = InternalSseEvent & {
  eventId: string;
  timestamp: string;
};
