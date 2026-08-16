import type { PostDto } from "@brickr/shared";
import { describe, expect, it } from "vitest";

import {
  INITIAL_SIMULATION_EVENT_STATE,
  reduceSimulationEvents,
  type SimulationEventAction,
  type SimulationEventState,
} from "./simulation-event-state";

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
  actions: SimulationEventAction[],
  from: SimulationEventState = INITIAL_SIMULATION_EVENT_STATE,
): SimulationEventState {
  return actions.reduce(reduceSimulationEvents, from);
}

const first = post("post-1", "2026-08-13T10:00:00.000Z");
const second = post("post-2", "2026-08-13T10:00:01.000Z");

describe("simulation event state: REST and stream race (§11.4)", () => {
  /**
   * The whole reason the client subscribes before it fetches: a post generated
   * while the history request is in flight must survive, and must not appear
   * twice when the history finally lands.
   */
  it("keeps one copy when the stream arrives before the history", () => {
    const state = apply([
      { kind: "upsertPosts", posts: [second] },
      { kind: "hydrated", posts: [first, second] },
    ]);

    expect(state.posts.map((entry) => entry.id)).toEqual(["post-1", "post-2"]);
    expect(state.loading).toBe(false);
  });

  it("keeps one copy when the history arrives first", () => {
    const state = apply([
      { kind: "hydrated", posts: [first, second] },
      { kind: "upsertPosts", posts: [second] },
    ]);

    expect(state.posts.map((entry) => entry.id)).toEqual(["post-1", "post-2"]);
  });

  it("replaces an existing post rather than duplicating it, and keeps order", () => {
    const edited: PostDto = { ...second, content: "updated" };

    const state = apply([
      { kind: "hydrated", posts: [second] },
      { kind: "upsertPosts", posts: [edited, first] },
    ]);

    expect(state.posts.map((entry) => entry.id)).toEqual(["post-1", "post-2"]);
    expect(state.posts[1]?.content).toBe("updated");
  });

  it("orders equal timestamps by id so the list never jitters", () => {
    const sameMomentA = post("post-a", "2026-08-13T10:00:00.000Z");
    const sameMomentB = post("post-b", "2026-08-13T10:00:00.000Z");

    const state = apply([{ kind: "upsertPosts", posts: [sameMomentB, sameMomentA] }]);

    expect(state.posts.map((entry) => entry.id)).toEqual(["post-a", "post-b"]);
  });
});

describe("simulation event state: anonymous response activity (§11.3)", () => {
  const started: SimulationEventAction = {
    kind: "responseStarted",
    activity: { activityId: "activity-1", targetPostId: "post-1" },
  };

  it("counts responses in flight and clears them as they finish", () => {
    const state = apply([
      started,
      {
        kind: "responseStarted",
        activity: { activityId: "activity-2", targetPostId: "post-1" },
      },
      { kind: "responseFinished", activityId: "activity-1", failed: false },
    ]);

    expect(state.activities.map((entry) => entry.activityId)).toEqual(["activity-2"]);
    expect(state.failedResponses).toBe(0);
  });

  it("ignores a repeated start, so a reconnect cannot double-count", () => {
    const state = apply([started, started]);

    expect(state.activities).toHaveLength(1);
  });

  /** Aggregated: the stream never says which response failed, or why (§11.2). */
  it("counts failures without keeping anything about them", () => {
    const state = apply([
      started,
      { kind: "responseFinished", activityId: "activity-1", failed: true },
    ]);

    expect(state.activities).toEqual([]);
    expect(state.failedResponses).toBe(1);
    expect(JSON.stringify(state)).not.toContain("reason");
  });

  it("forgets in-flight responses when the stream drops", () => {
    const state = apply([started, { kind: "disconnected" }]);

    // Nothing can finish while disconnected, so an indicator would hang forever.
    expect(state.activities).toEqual([]);
    expect(state.connection).toBe("disconnected");
  });

  it("clears the failure notice on dismissal", () => {
    const state = apply([
      started,
      { kind: "responseFinished", activityId: "activity-1", failed: true },
      { kind: "dismissFailures" },
    ]);

    expect(state.failedResponses).toBe(0);
  });
});
