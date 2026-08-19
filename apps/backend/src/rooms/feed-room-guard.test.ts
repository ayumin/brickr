import { describe, expect, it } from "vitest";
import { assertNotFeedRoom, FeedRoomImmutableError } from "./feed-room-guard.js";

describe("assertNotFeedRoom", () => {
  it("throws FeedRoomImmutableError for a room with scope: global", () => {
    expect(() => assertNotFeedRoom({ scope: "global" })).toThrow(FeedRoomImmutableError);
  });

  it("does not throw for a room with scope: room", () => {
    expect(() => assertNotFeedRoom({ scope: "room" })).not.toThrow();
  });
});
