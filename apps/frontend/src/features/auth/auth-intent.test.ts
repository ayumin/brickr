import { describe, expect, it } from "vitest";
import { GLOBAL_SIMULATION_ID } from "@brickr/shared";
import { composerContextLandingPath } from "./auth-intent";

describe("composerContextLandingPath", () => {
  it("lands on the feed for the global simulation", () => {
    expect(
      composerContextLandingPath({ mode: "new", simulationId: GLOBAL_SIMULATION_ID, roomLabel: "フィード" }),
    ).toBe("/");
  });

  it("lands on the room for a room-scoped new post", () => {
    expect(
      composerContextLandingPath({ mode: "new", simulationId: "room-1", roomLabel: "雑談" }),
    ).toBe("/rooms/room-1");
  });

  it("lands on the target post's room for a reply, not the feed", () => {
    const post = {
      id: "p1",
      roomId: "room-2",
      author: { id: "a", handle: "architect", displayName: "Architect" },
      content: "hi",
      mentions: [],
      replyTo: null,
      quoteOf: null,
      quotedPost: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    expect(composerContextLandingPath({ mode: "reply", simulationId: "room-2", post })).toBe(
      "/rooms/room-2",
    );
  });
});
