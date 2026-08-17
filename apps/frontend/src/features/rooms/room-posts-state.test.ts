import type { PostDto } from "@brickr/shared";
import { describe, expect, it } from "vitest";

import {
  INITIAL_ROOM_POSTS_STATE,
  mergeRoomPosts,
  reduceRoomPosts,
  type RoomPostsAction,
  type RoomPostsState,
} from "./room-posts-state";

function post(id: string, createdAt: string): PostDto {
  return {
    id,
    roomId: "room-1",
    author: { id: "author-1", handle: "author_1", displayName: "著者" },
    content: id,
    mentions: [],
    replyTo: null,
    quoteOf: null,
    quotedPost: null,
    createdAt,
  };
}

function apply(
  actions: RoomPostsAction[],
  from: RoomPostsState = INITIAL_ROOM_POSTS_STATE,
): RoomPostsState {
  return actions.reduce(reduceRoomPosts, from);
}

const first = post("post-1", "2026-08-13T10:00:00.000Z");
const second = post("post-2", "2026-08-13T10:00:01.000Z");

describe("room post state: REST and stream race", () => {
  it("keeps one copy when a streamed post arrives before history", () => {
    const state = apply([
      { kind: "upsertPosts", posts: [second] },
      { kind: "hydrated", posts: [first, second] },
    ]);

    expect(state.posts.map((entry) => entry.id)).toEqual(["post-1", "post-2"]);
    expect(state.loading).toBe(false);
  });

  it("keeps one copy when history arrives before a streamed post", () => {
    const state = apply([
      { kind: "hydrated", posts: [first, second] },
      { kind: "upsertPosts", posts: [second] },
    ]);

    expect(state.posts.map((entry) => entry.id)).toEqual(["post-1", "post-2"]);
  });

  it("replaces an existing post and preserves chronological order", () => {
    const edited: PostDto = { ...second, content: "updated" };
    const state = apply([
      { kind: "hydrated", posts: [second] },
      { kind: "upsertPosts", posts: [edited, first] },
    ]);

    expect(state.posts.map((entry) => entry.id)).toEqual(["post-1", "post-2"]);
    expect(state.posts[1]?.content).toBe("updated");
  });

  it("orders equal timestamps by id so the list does not jitter", () => {
    const sameMomentA = post("post-a", "2026-08-13T10:00:00.000Z");
    const sameMomentB = post("post-b", "2026-08-13T10:00:00.000Z");

    expect(mergeRoomPosts([], [sameMomentB, sameMomentA]).map((entry) => entry.id)).toEqual([
      "post-a",
      "post-b",
    ]);
  });

  it("preserves the existing array when there are no incoming posts", () => {
    const existing = [first];
    expect(mergeRoomPosts(existing, [])).toBe(existing);
  });
});

describe("room post state: response activity and connection", () => {
  const started: RoomPostsAction = {
    kind: "responseStarted",
    activity: { activityId: "activity-1", targetPostId: "post-1" },
  };

  it("tracks responses in flight and clears them as they finish", () => {
    const state = apply([
      started,
      {
        kind: "responseStarted",
        activity: { activityId: "activity-2", targetPostId: "post-1" },
      },
      { kind: "responseFinished", activityId: "activity-1" },
    ]);

    expect(state.activities.map((entry) => entry.activityId)).toEqual(["activity-2"]);
  });

  it("ignores a repeated start after a reconnect", () => {
    const state = apply([started, started]);
    expect(state.activities).toHaveLength(1);
  });

  it("clears in-flight responses when the stream disconnects", () => {
    const state = apply([started, { kind: "disconnected" }]);
    expect(state.activities).toEqual([]);
    expect(state.connection).toBe("disconnected");
  });

  it("updates the connection state without replacing equal state", () => {
    const connected = apply([{ kind: "connection", connection: "open" }]);
    expect(connected.connection).toBe("open");
    expect(reduceRoomPosts(connected, { kind: "connection", connection: "open" })).toBe(
      connected,
    );
  });

  it("records load errors and reset restores the initial state", () => {
    const failed = apply([{ kind: "loadFailed", message: "offline" }]);
    expect(failed).toMatchObject({ loading: false, error: "offline" });
    expect(reduceRoomPosts(failed, { kind: "reset" })).toBe(INITIAL_ROOM_POSTS_STATE);
  });
});
