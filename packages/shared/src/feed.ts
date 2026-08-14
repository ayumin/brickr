import type { PostDto } from "./post.js";

/**
 * `mine` is "threads that concern me" (§12.3), not "threads I appear in": the
 * root is mine, a reply answers a post of mine, or my handle is mentioned.
 * Merely having posted somewhere in the thread does not qualify, otherwise the
 * filter would drift into a second copy of `all`.
 */
export const FEED_FILTERS = ["all", "mine"] as const;

export type FeedFilter = (typeof FEED_FILTERS)[number];

/**
 * The room a thread lives in, as the feed shows it.
 *
 * `isFeed` marks the reserved global simulation (§8.2), so the client can label
 * it「フィード」without being told about `scope`, which stays internal. Whether a
 * room is stopped is deliberately absent: that shows up only through
 * `capabilities`, never as a label on the feed (§16.3).
 */
export type FeedRoomRefDto = {
  id: string;
  title: string;
  isFeed: boolean;
};

/**
 * What the caller may do with this thread, decided by the server.
 *
 * The client must not infer any of it from a status field or from whether a
 * session exists (§9.3): the answer differs per thread — a stopped room still
 * shows its posts but accepts no replies, and its thread detail opens for the
 * creator and an administrator only.
 */
export type FeedCapabilitiesDto = {
  canOpenAuthor: boolean;
  canOpenRoom: boolean;
  canOpenThread: boolean;
  canReply: boolean;
  canQuote: boolean;
  canLoadMoreReplies: boolean;
};

export type FeedThreadDto = {
  root: PostDto;
  room: FeedRoomRefDto;
  /** At most 2, oldest first: the newest two replies, shown in reading order (§12.2). */
  latestReplies: PostDto[];
  /** Every transitive reply, including the ones not previewed. */
  replyCount: number;
  lastActivityAt: string;
  capabilities: FeedCapabilitiesDto;
};

/**
 * One page of threads, newest activity first.
 *
 * `nextCursor` is opaque: only the server encodes and decodes it (§9.4), so the
 * ordering it describes can change without breaking a client that stored one.
 * `null` means the end of the feed.
 */
export type FeedPageDto = {
  threads: FeedThreadDto[];
  nextCursor: string | null;
};
