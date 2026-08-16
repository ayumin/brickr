/**
 * State-change notifications sent by the Feed and Room SSE streams.
 *
 * SSE is not a state-recovery mechanism. Payloads deliberately contain only
 * identifiers and minimal transient state; clients re-fetch authoritative data
 * over REST. Delivery order is not guaranteed and clients should discard recent
 * duplicate `eventId` values.
 */
export const SSE_EVENT_TYPES = [
  "post.created",
  "response.started",
  "response.finished",
] as const;

export type SseEventType = (typeof SSE_EVENT_TYPES)[number];

/** How one response ended. Never why — a reason names models and providers (§11.2). */
export const RESPONSE_OUTCOMES = ["posted", "skipped", "failed"] as const;

export type ResponseOutcome = (typeof RESPONSE_OUTCOMES)[number];

export type SseEventBase<T extends SseEventType> = {
  /** Unique delivery identifier used by clients for short-term deduplication. */
  eventId: string;
  /** The affected room. `null` is reserved for feed-wide state changes. */
  roomId: string | null;
  type: T;
  /** ISO 8601 time at which the notification was published. */
  timestamp: string;
};

/** A post changed a thread. Fetch the relevant feed or thread over REST. */
export type PostCreatedEvent = SseEventBase<"post.created"> & {
  postId: string;
  threadRootId: string;
};

/**
 * A response is being generated. Who is generating it is deliberately absent.
 *
 * `activityId` means nothing outside this pair of events: it exists only so a
 * client can match a finish to a start and say "n responses in flight" (§11.3).
 */
export type ResponseStartedEvent = SseEventBase<"response.started"> & {
  activityId: string;
  targetPostId: string;
  threadRootId: string;
};

/** The end of one `response.started`. Exactly one arrives for every start. */
export type ResponseFinishedEvent = SseEventBase<"response.finished"> & {
  activityId: string;
  targetPostId: string;
  threadRootId: string;
  outcome: ResponseOutcome;
};

export type SseEvent = PostCreatedEvent | ResponseStartedEvent | ResponseFinishedEvent;
