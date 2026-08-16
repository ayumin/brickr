import type { FeedThreadDto, PostDto } from "@brickr/shared";
import { describe, expect, it } from "vitest";

import { INITIAL_FEED_STATE, reduceFeed, type FeedAction, type FeedState } from "./feed-reducer";

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

function thread(rootId: string, lastActivityAt: string, overrides: Partial<FeedThreadDto> = {}): FeedThreadDto {
  return {
    root: post(rootId, { createdAt: lastActivityAt }),
    room: { id: "room-1", title: "ルーム1", isFeed: false },
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

const threadA = thread("thread-a", "2026-08-13T10:00:00.000Z");
const threadB = thread("thread-b", "2026-08-13T10:01:00.000Z");
const threadC = thread("thread-c", "2026-08-13T10:02:00.000Z");

describe("feed reducer: initial page and load more (§13.4)", () => {
  it("replaces existing state on an initial page load", () => {
    const seeded = apply([{ kind: "initialLoaded", page: { threads: [threadA], nextCursor: null } }]);

    const state = apply(
      [{ kind: "initialLoaded", page: { threads: [threadB, threadC], nextCursor: "cursor-1" } }],
      seeded,
    );

    expect(ids(state)).toEqual(["thread-c", "thread-b"]);
    expect(state.nextCursor).toBe("cursor-1");
    expect(state.loadingInitial).toBe(false);
  });

  it("dedupes existing root ids and appends the rest on load more", () => {
    const seeded = apply([
      { kind: "initialLoaded", page: { threads: [threadC, threadB], nextCursor: "cursor-1" } },
    ]);

    const state = apply(
      [
        {
          kind: "loadMoreLoaded",
          page: { threads: [threadB, threadA], nextCursor: null },
        },
      ],
      seeded,
    );

    // threadB was already loaded, so only threadA is appended, and order is
    // preserved rather than re-sorted.
    expect(ids(state)).toEqual(["thread-c", "thread-b", "thread-a"]);
    expect(state.nextCursor).toBeNull();
    expect(state.loadingMore).toBe(false);
  });
});

describe("feed reducer: upsert re-sorts (§12.1)", () => {
  it("updates an existing thread in place and re-sorts to the front", () => {
    const seeded = apply([
      { kind: "initialLoaded", page: { threads: [threadB, threadA], nextCursor: null } },
    ]);

    const bumped = thread("thread-a", "2026-08-13T10:05:00.000Z");
    const state = apply([{ kind: "upsertThread", thread: bumped, filter: "all" }], seeded);

    expect(ids(state)).toEqual(["thread-a", "thread-b"]);
    expect(state.byId.get("thread-a")?.lastActivityAt).toBe("2026-08-13T10:05:00.000Z");
  });

  it("inserts a new thread at the correct position by lastActivityAt", () => {
    const seeded = apply([
      { kind: "initialLoaded", page: { threads: [threadC, threadA], nextCursor: null } },
    ]);

    const state = apply([{ kind: "upsertThread", thread: threadB, filter: "all" }], seeded);

    expect(ids(state)).toEqual(["thread-c", "thread-b", "thread-a"]);
  });

  it("breaks a lastActivityAt tie by root id, descending, for a stable order", () => {
    const sameMomentA = thread("thread-a", "2026-08-13T10:00:00.000Z");
    const sameMomentB = thread("thread-b", "2026-08-13T10:00:00.000Z");

    const state = apply([
      { kind: "upsertThread", thread: sameMomentB, filter: "all" },
      { kind: "upsertThread", thread: sameMomentA, filter: "all" },
    ]);

    expect(ids(state)).toEqual(["thread-b", "thread-a"]);
  });

  it("dedupes an optimistic post against its own SSE echo, same root id", () => {
    const state = apply([
      { kind: "upsertThread", thread: threadA, filter: "all" },
      { kind: "upsertThread", thread: threadA, filter: "all" },
    ]);

    expect(ids(state)).toEqual(["thread-a"]);
  });

  it("adds a quote repost as its own thread without moving the quoted thread", () => {
    const seeded = apply([{ kind: "initialLoaded", page: { threads: [threadA], nextCursor: null } }]);

    // A quote repost is a distinct root post in an earlier thread, so it lands
    // independently rather than mutating threadA's position.
    const quoteThread = thread("thread-quote", "2026-08-13T09:00:00.000Z");
    const state = apply([{ kind: "upsertThread", thread: quoteThread, filter: "all" }], seeded);

    expect(ids(state)).toEqual(["thread-a", "thread-quote"]);
    expect(state.byId.get("thread-a")).toBe(threadA);
  });
});

describe("feed reducer: filter reset and mine's upsert restriction (§4 論点2)", () => {
  it("resets to the initial state on a filter change", () => {
    const seeded = apply([{ kind: "initialLoaded", page: { threads: [threadA], nextCursor: "c" } }]);

    const state = apply([{ kind: "reset" }], seeded);

    expect(state).toEqual(INITIAL_FEED_STATE);
  });

  it("does not insert a not-yet-loaded thread under the mine filter", () => {
    const state = apply([{ kind: "upsertThread", thread: threadA, filter: "mine" }]);

    expect(ids(state)).toEqual([]);
    expect(state.byId.size).toBe(0);
  });

  it("still applies an update to an already-loaded thread under the mine filter", () => {
    const seeded = apply([{ kind: "initialLoaded", page: { threads: [threadA], nextCursor: null } }]);

    const updated = thread("thread-a", "2026-08-13T10:05:00.000Z");
    const state = apply([{ kind: "upsertThread", thread: updated, filter: "mine" }], seeded);

    expect(state.byId.get("thread-a")?.lastActivityAt).toBe("2026-08-13T10:05:00.000Z");
  });
});

describe("feed reducer: anonymous response activity (§11.2, §11.3)", () => {
  it("counts responses in flight and clears them as they finish", () => {
    const state = apply([
      { kind: "responseStarted", activityId: "activity-1" },
      { kind: "responseStarted", activityId: "activity-2" },
      { kind: "responseFinished", activityId: "activity-1", failed: false },
    ]);

    expect(state.activeResponses).toEqual(new Set(["activity-2"]));
    expect(state.generationWarning).toBe(false);
  });

  it("raises the generation warning on a failed outcome", () => {
    const state = apply([
      { kind: "responseStarted", activityId: "activity-1" },
      { kind: "responseFinished", activityId: "activity-1", failed: true },
    ]);

    expect(state.activeResponses.size).toBe(0);
    expect(state.generationWarning).toBe(true);
    expect(JSON.stringify(state)).not.toContain("reason");
  });

  it("clears the generation warning on dismissal", () => {
    const state = apply([
      { kind: "responseStarted", activityId: "activity-1" },
      { kind: "responseFinished", activityId: "activity-1", failed: true },
      { kind: "dismissGenerationWarning" },
    ]);

    expect(state.generationWarning).toBe(false);
  });

  it("forgets in-flight responses when the stream drops", () => {
    const state = apply([
      { kind: "responseStarted", activityId: "activity-1" },
      { kind: "disconnected" },
    ]);

    expect(state.activeResponses.size).toBe(0);
    expect(state.connection).toBe("disconnected");
  });
});
