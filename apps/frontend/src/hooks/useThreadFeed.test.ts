/**
 * Tests for the useThreadFeed common state layer (Issue #167).
 *
 * These tests exercise the reducer logic that backs useThreadFeed for both
 * feed and room sources, covering:
 *   1. Feed source (`kind: 'all'`) vs Room source (`kind: 'room'`) reducer
 *      behaviour — both share the same reducer, so the source only affects
 *      which API endpoint is called; the state shape is identical.
 *   2. REST re-sync after an SSE notification: a `refreshed` action merges
 *      the newest page without discarding already-loaded pages or their cursor.
 *   3. Duplicate event deduplication: the same thread arriving twice (e.g.
 *      an optimistic upsert followed by the SSE echo) is collapsed to one
 *      entry and does not duplicate the id in `orderedIds`.
 *
 * All tests are pure reducer tests — no React, no DOM, no network — so they
 * run in the node environment configured by vitest.config.ts.
 */
import type { FeedThreadDto, PostDto } from "@brickr/shared";
import { describe, expect, it } from "vitest";

import {
  INITIAL_FEED_STATE,
  reduceFeed,
  type FeedAction,
  type FeedState,
} from "../features/feed/feed-reducer";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function post(id: string, overrides: Partial<PostDto> = {}): PostDto {
  return {
    id,
    roomId: "room-1",
    author: { id: "author-1", handle: "author_1", displayName: "著者" },
    content: id,
    mentions: [],
    replyTo: null,
    quoteOf: null,
    quotedPost: null,
    createdAt: "2026-08-13T10:00:00.000Z",
    ...overrides,
  };
}

function thread(
  rootId: string,
  lastActivityAt: string,
  overrides: Partial<FeedThreadDto> = {},
): FeedThreadDto {
  return {
    root: post(rootId, { createdAt: lastActivityAt }),
    room: { id: "room-1", title: "ルーム1" },
    latestReplies: [],
    replyCount: 0,
    lastActivityAt,
    capabilities: {
      canOpenAuthor: true,
      canOpenRoom: true,
      canOpenThread: true,
      canReply: true,
      canQuote: true,
      canLoadMoreReplies: false,
    },
    ...overrides,
  };
}

function apply(actions: FeedAction[], from: FeedState = INITIAL_FEED_STATE): FeedState {
  return actions.reduce(reduceFeed, from);
}

function ids(state: FeedState): string[] {
  return state.orderedIds;
}

// Threads used across suites
const threadA = thread("thread-a", "2026-08-13T10:00:00.000Z");
const threadB = thread("thread-b", "2026-08-13T10:01:00.000Z");
const threadC = thread("thread-c", "2026-08-13T10:02:00.000Z");
const threadD = thread("thread-d", "2026-08-13T10:03:00.000Z");

// ---------------------------------------------------------------------------
// Feed source (`kind: 'all'`) — initial load and pagination
// ---------------------------------------------------------------------------

describe("useThreadFeed — feed source (kind: 'all'): initial load and pagination", () => {
  it("starts in the loading state before any data arrives", () => {
    const state = apply([{ kind: "initialLoadStarted" }]);

    expect(state.loadingInitial).toBe(true);
    expect(state.initialError).toBeNull();
    expect(ids(state)).toEqual([]);
  });

  it("populates threads newest-activity-first after the initial page loads", () => {
    const state = apply([
      { kind: "initialLoadStarted" },
      { kind: "initialLoaded", page: { threads: [threadA, threadC, threadB], nextCursor: null } },
    ]);

    expect(ids(state)).toEqual(["thread-c", "thread-b", "thread-a"]);
    expect(state.loadingInitial).toBe(false);
    expect(state.nextCursor).toBeNull();
  });

  it("exposes a cursor when more pages are available", () => {
    const state = apply([
      { kind: "initialLoaded", page: { threads: [threadC, threadB], nextCursor: "cursor-1" } },
    ]);

    expect(state.nextCursor).toBe("cursor-1");
  });

  it("appends older threads on load-more without re-sorting the already-loaded list", () => {
    const seeded = apply([
      { kind: "initialLoaded", page: { threads: [threadC, threadB], nextCursor: "cursor-1" } },
    ]);

    const state = apply(
      [{ kind: "loadMoreLoaded", page: { threads: [threadA], nextCursor: null } }],
      seeded,
    );

    // threadC and threadB keep their positions; threadA is appended at the end.
    expect(ids(state)).toEqual(["thread-c", "thread-b", "thread-a"]);
    expect(state.nextCursor).toBeNull();
    expect(state.loadingMore).toBe(false);
  });

  it("records an error message when the initial fetch fails", () => {
    const state = apply([
      { kind: "initialLoadStarted" },
      { kind: "initialLoadFailed", message: "ネットワークエラー" },
    ]);

    expect(state.loadingInitial).toBe(false);
    expect(state.initialError).toBe("ネットワークエラー");
    expect(ids(state)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Room source (`kind: 'room'`) — same reducer, room-scoped threads
// ---------------------------------------------------------------------------

describe("useThreadFeed — room source (kind: 'room'): same reducer, room-scoped threads", () => {
  const roomThread1 = thread("room-thread-1", "2026-08-13T10:00:00.000Z", {
    room: { id: "room-42", title: "ルーム42" },
  });
  const roomThread2 = thread("room-thread-2", "2026-08-13T10:05:00.000Z", {
    room: { id: "room-42", title: "ルーム42" },
  });

  it("loads room-scoped threads with the same initial-load semantics as the feed source", () => {
    const state = apply([
      { kind: "initialLoadStarted" },
      {
        kind: "initialLoaded",
        page: { threads: [roomThread1, roomThread2], nextCursor: null },
      },
    ]);

    // Newest activity first, same as the unified feed.
    expect(ids(state)).toEqual(["room-thread-2", "room-thread-1"]);
    expect(state.loadingInitial).toBe(false);
  });

  it("replaces the room thread list on a filter change (reset)", () => {
    const seeded = apply([
      { kind: "initialLoaded", page: { threads: [roomThread1], nextCursor: null } },
    ]);

    const state = apply([{ kind: "reset" }], seeded);

    expect(state).toEqual(INITIAL_FEED_STATE);
  });

  it("dedupes a thread that appears in both the initial page and a load-more page", () => {
    const seeded = apply([
      {
        kind: "initialLoaded",
        page: { threads: [roomThread2, roomThread1], nextCursor: "cursor-1" },
      },
    ]);

    const state = apply(
      [
        {
          kind: "loadMoreLoaded",
          // roomThread1 is already loaded — only the new one should be appended.
          page: {
            threads: [roomThread1, thread("room-thread-3", "2026-08-13T09:00:00.000Z")],
            nextCursor: null,
          },
        },
      ],
      seeded,
    );

    expect(ids(state)).toEqual(["room-thread-2", "room-thread-1", "room-thread-3"]);
  });
});

// ---------------------------------------------------------------------------
// REST re-sync after SSE notification
// ---------------------------------------------------------------------------

describe("useThreadFeed — REST re-sync after SSE notification (refreshed action)", () => {
  it("merges the refreshed page into the existing list without discarding older pages", () => {
    // Simulate: initial page loaded, then a page-2 loaded, then an SSE
    // notification triggers a REST re-sync of the newest page.
    const seeded = apply([
      { kind: "initialLoaded", page: { threads: [threadC, threadB], nextCursor: "cursor-1" } },
      { kind: "loadMoreLoaded", page: { threads: [threadA], nextCursor: null } },
    ]);

    // SSE fires → REST re-sync returns a bumped threadC and a brand-new threadD.
    const bumpedC = thread("thread-c", "2026-08-13T10:10:00.000Z");
    const state = apply(
      [{ kind: "refreshed", page: { threads: [bumpedC, threadD], nextCursor: "ignored" } }],
      seeded,
    );

    // threadA (from page 2) is still present; threadC moved to the front.
    expect(ids(state)).toEqual(["thread-c", "thread-d", "thread-b", "thread-a"]);
    expect(state.byId.get("thread-a")).toBe(threadA);
    // The pagination cursor from page 2 is preserved — re-sync must not reset it.
    expect(state.nextCursor).toBeNull();
  });

  it("updates an existing thread's data when the re-sync returns a newer version", () => {
    const seeded = apply([
      { kind: "initialLoaded", page: { threads: [threadB, threadA], nextCursor: null } },
    ]);

    const updatedA = thread("thread-a", "2026-08-13T10:09:00.000Z");
    const state = apply(
      [{ kind: "refreshed", page: { threads: [updatedA], nextCursor: null } }],
      seeded,
    );

    expect(state.byId.get("thread-a")?.lastActivityAt).toBe("2026-08-13T10:09:00.000Z");
    // threadA now has newer activity than threadB, so it sorts to the front.
    expect(ids(state)).toEqual(["thread-a", "thread-b"]);
  });

  it("does not let a stale initial response overwrite a completed re-sync", () => {
    // A re-sync completes (loadingInitial becomes false via refreshed).
    const refreshed = apply([
      { kind: "refreshed", page: { threads: [threadD], nextCursor: null } },
    ]);

    // A slow initial fetch finally resolves — it must be ignored.
    const state = apply(
      [{ kind: "initialLoaded", page: { threads: [threadA], nextCursor: "stale" } }],
      refreshed,
    );

    expect(ids(state)).toEqual(["thread-d"]);
    expect(state.nextCursor).toBeNull();
  });

  it("preserves the pagination cursor across multiple re-syncs", () => {
    const seeded = apply([
      { kind: "initialLoaded", page: { threads: [threadC], nextCursor: "cursor-page-2" } },
    ]);

    const afterFirstSync = apply(
      [{ kind: "refreshed", page: { threads: [threadD], nextCursor: "ignored-1" } }],
      seeded,
    );
    const afterSecondSync = apply(
      [{ kind: "refreshed", page: { threads: [threadD], nextCursor: "ignored-2" } }],
      afterFirstSync,
    );

    // The cursor from the initial page must survive both re-syncs.
    expect(afterSecondSync.nextCursor).toBe("cursor-page-2");
  });
});

// ---------------------------------------------------------------------------
// Duplicate event deduplication
// ---------------------------------------------------------------------------

describe("useThreadFeed — duplicate event deduplication", () => {
  it("collapses two upserts for the same thread id into one entry", () => {
    const state = apply([
      { kind: "upsertThread", thread: threadA, filter: "all" },
      { kind: "upsertThread", thread: threadA, filter: "all" },
    ]);

    expect(ids(state)).toEqual(["thread-a"]);
    expect(state.byId.size).toBe(1);
  });

  it("keeps the latest data when the same thread is upserted twice with different timestamps", () => {
    const older = thread("thread-a", "2026-08-13T10:00:00.000Z");
    const newer = thread("thread-a", "2026-08-13T10:05:00.000Z");

    const state = apply([
      { kind: "upsertThread", thread: older, filter: "all" },
      { kind: "upsertThread", thread: newer, filter: "all" },
    ]);

    expect(state.byId.get("thread-a")?.lastActivityAt).toBe("2026-08-13T10:05:00.000Z");
    expect(ids(state)).toEqual(["thread-a"]);
  });

  it("dedupes an optimistic upsert against its SSE echo (same root id)", () => {
    // Optimistic insert happens immediately after the user posts.
    const optimistic = thread("thread-new", "2026-08-13T10:06:00.000Z");
    // SSE echo arrives shortly after with the same root id.
    const sseEcho = thread("thread-new", "2026-08-13T10:06:00.000Z");

    const state = apply([
      { kind: "upsertThread", thread: optimistic, filter: "all" },
      { kind: "upsertThread", thread: sseEcho, filter: "all" },
    ]);

    expect(ids(state)).toEqual(["thread-new"]);
    expect(state.byId.size).toBe(1);
  });

  it("dedupes a thread that appears in both an initial page and a subsequent upsert", () => {
    const seeded = apply([
      { kind: "initialLoaded", page: { threads: [threadB, threadA], nextCursor: null } },
    ]);

    // SSE fires for threadA (e.g. a new reply) — upsert must update, not duplicate.
    const updatedA = thread("thread-a", "2026-08-13T10:07:00.000Z");
    const state = apply([{ kind: "upsertThread", thread: updatedA, filter: "all" }], seeded);

    expect(ids(state)).toEqual(["thread-a", "thread-b"]);
    expect(state.byId.size).toBe(2);
    expect(state.byId.get("thread-a")?.lastActivityAt).toBe("2026-08-13T10:07:00.000Z");
  });

  it("dedupes a thread that appears in both a load-more page and a subsequent upsert", () => {
    const seeded = apply([
      { kind: "initialLoaded", page: { threads: [threadC], nextCursor: "cursor-1" } },
      { kind: "loadMoreLoaded", page: { threads: [threadA], nextCursor: null } },
    ]);

    // SSE fires for threadA — must update in place, not append a second entry.
    const updatedA = thread("thread-a", "2026-08-13T10:08:00.000Z");
    const state = apply([{ kind: "upsertThread", thread: updatedA, filter: "all" }], seeded);

    expect(ids(state)).toEqual(["thread-a", "thread-c"]);
    expect(state.byId.size).toBe(2);
  });

  it("does not insert a new thread under the mine filter (server-side membership guard)", () => {
    // The server decides mine-membership; the client must not insert a thread
    // it has never loaded under that filter, even if an SSE event arrives.
    const state = apply([{ kind: "upsertThread", thread: threadA, filter: "mine" }]);

    expect(ids(state)).toEqual([]);
    expect(state.byId.size).toBe(0);
  });

  it("still updates an already-loaded thread under the mine filter", () => {
    const seeded = apply([
      { kind: "initialLoaded", page: { threads: [threadA], nextCursor: null } },
    ]);

    const updated = thread("thread-a", "2026-08-13T10:09:00.000Z");
    const state = apply([{ kind: "upsertThread", thread: updated, filter: "mine" }], seeded);

    expect(state.byId.get("thread-a")?.lastActivityAt).toBe("2026-08-13T10:09:00.000Z");
    expect(ids(state)).toEqual(["thread-a"]);
  });

  it("dedupes a thread that appears in both a refreshed page and a load-more page", () => {
    // Page 1 loaded, then page 2 loaded, then a re-sync returns a thread
    // that was already in page 2 — it must not appear twice.
    const seeded = apply([
      { kind: "initialLoaded", page: { threads: [threadC], nextCursor: "cursor-1" } },
      { kind: "loadMoreLoaded", page: { threads: [threadA], nextCursor: null } },
    ]);

    // Re-sync returns threadA (already loaded) and threadD (new).
    const state = apply(
      [{ kind: "refreshed", page: { threads: [threadD, threadA], nextCursor: "ignored" } }],
      seeded,
    );

    // threadA must appear exactly once; threadD is new and inserted.
    const allIds = ids(state);
    const threadACount = allIds.filter((id) => id === "thread-a").length;
    expect(threadACount).toBe(1);
    expect(allIds).toContain("thread-d");
    expect(allIds).toContain("thread-c");
    expect(state.byId.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Connection state transitions
// ---------------------------------------------------------------------------

describe("useThreadFeed — connection state transitions", () => {
  it("starts in the connecting state", () => {
    expect(INITIAL_FEED_STATE.connection).toBe("connecting");
  });

  it("transitions to open when the SSE stream connects", () => {
    const state = apply([{ kind: "connection", connection: "open" }]);
    expect(state.connection).toBe("open");
  });

  it("transitions to reconnecting on a transport error", () => {
    const state = apply([
      { kind: "connection", connection: "open" },
      { kind: "connection", connection: "reconnecting" },
    ]);
    expect(state.connection).toBe("reconnecting");
  });

  it("clears in-flight response indicators when the stream disconnects", () => {
    const state = apply([
      { kind: "responseStarted", activityId: "act-1" },
      { kind: "disconnected" },
    ]);

    expect(state.activeResponses.size).toBe(0);
    expect(state.connection).toBe("disconnected");
  });

  it("is a no-op when the connection state does not change", () => {
    const before = apply([{ kind: "connection", connection: "open" }]);
    const after = apply([{ kind: "connection", connection: "open" }], before);

    // Referential equality: the reducer must return the same object.
    expect(after).toBe(before);
  });
});
