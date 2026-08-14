/**
 * Unit tests for capability-based action display in the feed thread card
 * (§9.3, §16.3, §27).
 *
 * The client must never infer what a reader may do from a `status` field or
 * from whether a session exists — the server encodes the answer in
 * `capabilities` and the UI maps it 1-to-1 to interactive affordances.
 *
 * These tests cover the three canonical capability states the server produces:
 *   1. Anonymous reader  — all capabilities false (§10.1)
 *   2. Active room       — all capabilities true (normal signed-in reader)
 *   3. Stopped room      — write actions and room navigation off, read
 *                          actions depend on whether the reader is the
 *                          creator / administrator (§16.3)
 */
import { describe, expect, it } from "vitest";
import type { FeedCapabilitiesDto } from "@brickr/shared";

import { selectFeedThreadActions } from "./feed-actions";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** All capabilities false — what an anonymous reader receives (§10.1). */
const ANONYMOUS: FeedCapabilitiesDto = {
  canOpenAuthor: false,
  canOpenRoom: false,
  canOpenThread: false,
  canReply: false,
  canQuote: false,
  canLoadMoreReplies: false,
};

/** All capabilities true — a signed-in reader in an active room. */
const ACTIVE_ROOM: FeedCapabilitiesDto = {
  canOpenAuthor: true,
  canOpenRoom: true,
  canOpenThread: true,
  canReply: true,
  canQuote: true,
  canLoadMoreReplies: true,
};

/**
 * Stopped room, non-owner reader.
 *
 * Write actions and room navigation are off; read actions (thread detail,
 * more replies) are also off for a stranger (§16.3).
 */
const STOPPED_STRANGER: FeedCapabilitiesDto = {
  canOpenAuthor: true,
  canOpenRoom: false,
  canOpenThread: false,
  canReply: false,
  canQuote: false,
  canLoadMoreReplies: false,
};

/**
 * Stopped room, creator or administrator.
 *
 * Write actions and room navigation are still off, but read actions stay on
 * so the owner can inspect the thread in full (§16.3).
 */
const STOPPED_OWNER: FeedCapabilitiesDto = {
  canOpenAuthor: true,
  canOpenRoom: false,
  canOpenThread: true,
  canReply: false,
  canQuote: false,
  canLoadMoreReplies: true,
};

// ---------------------------------------------------------------------------
// Anonymous reader (§10.1, §27)
// ---------------------------------------------------------------------------

describe("selectFeedThreadActions — anonymous reader (§10.1, §27)", () => {
  it("disables every root action so no interactive element is emitted", () => {
    const { root } = selectFeedThreadActions(ANONYMOUS);

    expect(root.canOpenAuthor).toBe(false);
    expect(root.canOpenRoom).toBe(false);
    expect(root.canOpenThread).toBe(false);
    expect(root.canReply).toBe(false);
    expect(root.canQuote).toBe(false);
  });

  it("disables every reply action so no interactive element is emitted", () => {
    const { replies } = selectFeedThreadActions(ANONYMOUS);

    expect(replies.canOpenAuthor).toBe(false);
    expect(replies.canOpenThread).toBe(false);
  });

  it("hides the 'show more replies' button", () => {
    expect(selectFeedThreadActions(ANONYMOUS).showMoreReplies).toBe(false);
  });

  it("produces all-false actions regardless of which capability is checked", () => {
    const actions = selectFeedThreadActions(ANONYMOUS);

    // Flatten to a single array so a new field added to either type is caught
    // automatically without updating this assertion.
    const allValues = [
      ...Object.values(actions.root),
      ...Object.values(actions.replies),
      actions.showMoreReplies,
    ];

    expect(allValues.every((v) => v === false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Active room — signed-in reader (§9.3)
// ---------------------------------------------------------------------------

describe("selectFeedThreadActions — active room, signed-in reader (§9.3)", () => {
  it("enables author and room navigation on the root post", () => {
    const { root } = selectFeedThreadActions(ACTIVE_ROOM);

    expect(root.canOpenAuthor).toBe(true);
    expect(root.canOpenRoom).toBe(true);
  });

  it("enables thread expansion on the root post", () => {
    expect(selectFeedThreadActions(ACTIVE_ROOM).root.canOpenThread).toBe(true);
  });

  it("enables reply and repost actions on the root post", () => {
    const { root } = selectFeedThreadActions(ACTIVE_ROOM);

    expect(root.canReply).toBe(true);
    expect(root.canQuote).toBe(true);
  });

  it("enables author navigation on reply previews", () => {
    expect(selectFeedThreadActions(ACTIVE_ROOM).replies.canOpenAuthor).toBe(true);
  });

  it("enables thread expansion on reply previews", () => {
    expect(selectFeedThreadActions(ACTIVE_ROOM).replies.canOpenThread).toBe(true);
  });

  it("shows the 'show more replies' button", () => {
    expect(selectFeedThreadActions(ACTIVE_ROOM).showMoreReplies).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stopped room — non-owner reader (§16.3)
// ---------------------------------------------------------------------------

describe("selectFeedThreadActions — stopped room, non-owner reader (§16.3)", () => {
  it("hides the room link so the room cannot be opened from the feed", () => {
    expect(selectFeedThreadActions(STOPPED_STRANGER).root.canOpenRoom).toBe(false);
  });

  it("disables reply and repost actions — stopped means readable, not writable", () => {
    const { root } = selectFeedThreadActions(STOPPED_STRANGER);

    expect(root.canReply).toBe(false);
    expect(root.canQuote).toBe(false);
  });

  it("disables thread expansion for a non-owner reader", () => {
    expect(selectFeedThreadActions(STOPPED_STRANGER).root.canOpenThread).toBe(false);
  });

  it("hides the 'show more replies' button for a non-owner reader", () => {
    expect(selectFeedThreadActions(STOPPED_STRANGER).showMoreReplies).toBe(false);
  });

  it("still enables author navigation — the author profile is not stopped", () => {
    const actions = selectFeedThreadActions(STOPPED_STRANGER);

    expect(actions.root.canOpenAuthor).toBe(true);
    expect(actions.replies.canOpenAuthor).toBe(true);
  });

  it("disables thread expansion on reply previews for a non-owner reader", () => {
    expect(selectFeedThreadActions(STOPPED_STRANGER).replies.canOpenThread).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stopped room — creator or administrator (§16.3)
// ---------------------------------------------------------------------------

describe("selectFeedThreadActions — stopped room, creator/admin (§16.3)", () => {
  it("still hides the room link even for the owner", () => {
    expect(selectFeedThreadActions(STOPPED_OWNER).root.canOpenRoom).toBe(false);
  });

  it("still disables reply and repost actions even for the owner", () => {
    const { root } = selectFeedThreadActions(STOPPED_OWNER);

    expect(root.canReply).toBe(false);
    expect(root.canQuote).toBe(false);
  });

  it("keeps thread expansion enabled for the owner", () => {
    expect(selectFeedThreadActions(STOPPED_OWNER).root.canOpenThread).toBe(true);
  });

  it("shows the 'show more replies' button for the owner", () => {
    expect(selectFeedThreadActions(STOPPED_OWNER).showMoreReplies).toBe(true);
  });

  it("keeps author navigation enabled for the owner", () => {
    const actions = selectFeedThreadActions(STOPPED_OWNER);

    expect(actions.root.canOpenAuthor).toBe(true);
    expect(actions.replies.canOpenAuthor).toBe(true);
  });

  it("keeps thread expansion on reply previews enabled for the owner", () => {
    expect(selectFeedThreadActions(STOPPED_OWNER).replies.canOpenThread).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Global feed room (§10.2) — canOpenRoom is always false
// ---------------------------------------------------------------------------

describe("selectFeedThreadActions — global feed room (§10.2)", () => {
  it("never offers to open the feed as a room", () => {
    const globalFeedCapabilities: FeedCapabilitiesDto = {
      ...ACTIVE_ROOM,
      canOpenRoom: false,
    };

    expect(selectFeedThreadActions(globalFeedCapabilities).root.canOpenRoom).toBe(false);
  });

  it("still enables all other actions for a signed-in reader in the global feed", () => {
    const globalFeedCapabilities: FeedCapabilitiesDto = {
      ...ACTIVE_ROOM,
      canOpenRoom: false,
    };
    const { root } = selectFeedThreadActions(globalFeedCapabilities);

    expect(root.canOpenAuthor).toBe(true);
    expect(root.canOpenThread).toBe(true);
    expect(root.canReply).toBe(true);
    expect(root.canQuote).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mapping fidelity — each capability maps to exactly one action field
// ---------------------------------------------------------------------------

describe("selectFeedThreadActions — 1-to-1 capability mapping", () => {
  it("reflects canOpenAuthor into both root and reply actions", () => {
    const withAuthor = selectFeedThreadActions({ ...ANONYMOUS, canOpenAuthor: true });

    expect(withAuthor.root.canOpenAuthor).toBe(true);
    expect(withAuthor.replies.canOpenAuthor).toBe(true);
  });

  it("reflects canOpenRoom only into root.canOpenRoom", () => {
    const withRoom = selectFeedThreadActions({ ...ANONYMOUS, canOpenRoom: true });

    expect(withRoom.root.canOpenRoom).toBe(true);
    // Does not bleed into reply actions.
    expect(withRoom.replies.canOpenAuthor).toBe(false);
    expect(withRoom.replies.canOpenThread).toBe(false);
  });

  it("reflects canOpenThread into both root and reply actions", () => {
    const withThread = selectFeedThreadActions({ ...ANONYMOUS, canOpenThread: true });

    expect(withThread.root.canOpenThread).toBe(true);
    expect(withThread.replies.canOpenThread).toBe(true);
  });

  it("reflects canReply only into root.canReply", () => {
    const withReply = selectFeedThreadActions({ ...ANONYMOUS, canReply: true });

    expect(withReply.root.canReply).toBe(true);
    // Does not bleed into reply actions.
    expect(withReply.replies.canOpenAuthor).toBe(false);
    expect(withReply.replies.canOpenThread).toBe(false);
  });

  it("reflects canQuote only into root.canQuote", () => {
    const withQuote = selectFeedThreadActions({ ...ANONYMOUS, canQuote: true });

    expect(withQuote.root.canQuote).toBe(true);
    // Does not bleed into reply actions.
    expect(withQuote.replies.canOpenAuthor).toBe(false);
    expect(withQuote.replies.canOpenThread).toBe(false);
  });

  it("reflects canLoadMoreReplies into showMoreReplies", () => {
    const withMore = selectFeedThreadActions({ ...ANONYMOUS, canLoadMoreReplies: true });

    expect(withMore.showMoreReplies).toBe(true);
  });
});
