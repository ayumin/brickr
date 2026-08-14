import type { FeedCapabilitiesDto } from "@brickr/shared";

/** Everything the capability rules depend on, so the decision stays one pure function. */
export type FeedCapabilityInput = {
  /** Absent for an anonymous reader: the feed itself is public (§10.1). */
  isSignedIn: boolean;
  /** The reserved global row, shown as the feed rather than as a room (§8.2). */
  isFeedRoom: boolean;
  isStoppedRoom: boolean;
  /** Creator or administrator of the room this thread lives in (§66.6). */
  isRoomOwnerOrAdmin: boolean;
  replyCount: number;
  previewedReplyCount: number;
};

const NOTHING: FeedCapabilitiesDto = {
  canOpenAuthor: false,
  canOpenRoom: false,
  canOpenThread: false,
  canReply: false,
  canQuote: false,
  canLoadMoreReplies: false,
};

/**
 * What the caller may do with one thread (§10.1, §16.3).
 *
 * Every rule here exists so the client never has to guess:
 *
 * - Anonymous readers get nothing. The feed is readable without a session, but
 *   every action behind it — profiles, thread detail, replies — requires one.
 * - A stopped room refuses replies and quotes for *everyone*, creator and
 *   administrator included: stopping means "readable, not writable" (§10.4), and
 *   the feed stays a surface that looks the same for all readers.
 * - Its room cannot be opened from the feed either, for the same reason; the
 *   creator and an administrator reach a stopped room from the room list (§10.1).
 * - The thread detail is the one exception: it stays open to the creator and an
 *   administrator, since they are allowed to read a stopped room in full (§16.3).
 * - The global row has no room screen at all — `/api/simulations/:id/feed`
 *   refuses `scope=global` (§10.2) — so opening it as a room is never offered.
 * - "Show the remaining replies" is gated the same way as the thread detail,
 *   because it is served by the same reply endpoint (§10.8).
 */
export function toFeedCapabilities(input: FeedCapabilityInput): FeedCapabilitiesDto {
  if (!input.isSignedIn) return NOTHING;

  const canWrite = !input.isStoppedRoom;
  const canRead = !input.isStoppedRoom || input.isRoomOwnerOrAdmin;

  return {
    canOpenAuthor: true,
    canOpenRoom: !input.isFeedRoom && canWrite,
    canOpenThread: canRead,
    canReply: canWrite,
    canQuote: canWrite,
    canLoadMoreReplies: canRead && input.replyCount > input.previewedReplyCount,
  };
}
