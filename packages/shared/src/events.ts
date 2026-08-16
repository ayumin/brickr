import type { FeedThreadDto } from "./feed.js";

/**
 * SSE event names sent on `GET /api/feed/events` and `GET /api/simulations/:id/events`.
 *
 * Every one of them is anonymous (§11.2). The old `character.*` events named the
 * character that was generating, which made the feed's anonymity pointless: a
 * subscriber could match a name against a post and know its author was an AI.
 */
export const SSE_EVENT_TYPES = [
  "feed.post-created",
  "response.started",
  "response.finished",
] as const;

export type SseEventType = (typeof SSE_EVENT_TYPES)[number];

/** How one response ended. Never why — a reason names models and providers (§11.2). */
export const RESPONSE_OUTCOMES = ["posted", "skipped", "failed"] as const;

export type ResponseOutcome = (typeof RESPONSE_OUTCOMES)[number];

/**
 * A post was created, carrying the thread as it now stands.
 *
 * The whole thread rather than the single post: reply count, the newest two
 * replies, `lastActivityAt` and `capabilities` would otherwise have to be
 * recomputed by every client, which is the same feed logic implemented twice and
 * guaranteed to drift (§11.3). The server stays the only source of truth.
 */
export type FeedPostCreatedEvent = {
  type: "feed.post-created";
  thread: FeedThreadDto;
};

/**
 * A response is being generated. Who is generating it is deliberately absent.
 *
 * `activityId` means nothing outside this pair of events: it exists only so a
 * client can match a finish to a start and say "n responses in flight" (§11.3).
 */
export type ResponseStartedEvent = {
  type: "response.started";
  activityId: string;
  roomId: string;
  targetPostId: string;
  threadRootId: string;
};

/** The end of one `response.started`. Exactly one arrives for every start. */
export type ResponseFinishedEvent = {
  type: "response.finished";
  activityId: string;
  roomId: string;
  targetPostId: string;
  threadRootId: string;
  outcome: ResponseOutcome;
};

export type SseEvent = FeedPostCreatedEvent | ResponseStartedEvent | ResponseFinishedEvent;
