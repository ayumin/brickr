import { describe, expect, it } from "vitest";
import { composerContextLandingPath } from "./auth-intent";

describe("composerContextLandingPath", () => {
  it("lands on the destination room for a new post", () => {
    expect(
      composerContextLandingPath({ mode: "new", roomId: "room-1", roomLabel: "雑談" }),
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
    expect(composerContextLandingPath({ mode: "reply", roomId: "room-2", post })).toBe(
      "/rooms/room-2",
    );
  });
});
