import { describe, expect, it } from "vitest";
import { toFeedCapabilities, type FeedCapabilityInput } from "./feed-capabilities.js";

function input(overrides: Partial<FeedCapabilityInput> = {}): FeedCapabilityInput {
  return {
    isSignedIn: true,
    isFeedRoom: false,
    isStoppedRoom: false,
    isRoomOwnerOrAdmin: false,
    replyCount: 0,
    previewedReplyCount: 0,
    ...overrides,
  };
}

describe("feed capabilities (§10.1, §16.3)", () => {
  it("permits nothing at all for an anonymous reader", () => {
    const capabilities = toFeedCapabilities(input({ isSignedIn: false, replyCount: 9 }));

    expect(Object.values(capabilities)).toEqual([false, false, false, false, false, false]);
  });

  it("opens the room, the thread and the actions in an active room", () => {
    expect(toFeedCapabilities(input({ replyCount: 3, previewedReplyCount: 2 }))).toEqual({
      canOpenAuthor: true,
      canOpenRoom: true,
      canOpenThread: true,
      canReply: true,
      canQuote: true,
      canLoadMoreReplies: true,
    });
  });

  /** The global row is the feed itself; there is no room screen to open (§10.2). */
  it("never offers to open the feed as a room", () => {
    expect(toFeedCapabilities(input({ isFeedRoom: true })).canOpenRoom).toBe(false);
    expect(toFeedCapabilities(input({ isFeedRoom: true })).canReply).toBe(true);
  });

  /**
   * Stopping a room means "readable, not writable" (§10.4), and the feed has to
   * look the same for everyone — so even the creator writes nothing from here.
   */
  it("refuses writing and opening the room for a stopped room, owner included", () => {
    for (const isRoomOwnerOrAdmin of [false, true]) {
      const capabilities = toFeedCapabilities(input({ isStoppedRoom: true, isRoomOwnerOrAdmin }));

      expect(capabilities.canReply, `owner=${String(isRoomOwnerOrAdmin)}`).toBe(false);
      expect(capabilities.canQuote).toBe(false);
      expect(capabilities.canOpenRoom).toBe(false);
    }
  });

  it("keeps a stopped thread readable only for its creator or an administrator", () => {
    const stranger = toFeedCapabilities(
      input({ isStoppedRoom: true, replyCount: 5, previewedReplyCount: 2 }),
    );
    const owner = toFeedCapabilities(
      input({
        isStoppedRoom: true,
        isRoomOwnerOrAdmin: true,
        replyCount: 5,
        previewedReplyCount: 2,
      }),
    );

    expect(stranger.canOpenThread).toBe(false);
    expect(stranger.canLoadMoreReplies).toBe(false);
    expect(owner.canOpenThread).toBe(true);
    expect(owner.canLoadMoreReplies).toBe(true);
  });

  it("offers more replies only when some were left out", () => {
    expect(
      toFeedCapabilities(input({ replyCount: 2, previewedReplyCount: 2 })).canLoadMoreReplies,
    ).toBe(false);
    expect(
      toFeedCapabilities(input({ replyCount: 3, previewedReplyCount: 2 })).canLoadMoreReplies,
    ).toBe(true);
  });
});
