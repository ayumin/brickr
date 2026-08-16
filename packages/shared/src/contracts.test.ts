import { describe, expect, expectTypeOf, it } from "vitest";
import { API_ERROR_CODES, type ApiErrorCode } from "./errors.js";
import { SSE_EVENT_TYPES, type PostCreatedEvent, type SseEvent } from "./events.js";
import type { FeedRoomRefDto, ThreadFeedSource } from "./feed.js";

describe("Room Feed shared contracts", () => {
  it("models both the cross-room and room-scoped feed sources", () => {
    const all = { kind: "all" } satisfies ThreadFeedSource;
    const room = { kind: "room", roomId: "room-1" } satisfies ThreadFeedSource;

    expect(all.kind).toBe("all");
    expect(room.roomId).toBe("room-1");
  });

  it("represents the owning room without a synthetic global-feed marker", () => {
    const room = { id: "room-1", title: "設計の部屋" } satisfies FeedRoomRefDto;

    expect(room).not.toHaveProperty("isFeed");
  });
});

describe("Room SSE shared contracts", () => {
  it("uses minimal state-change event names", () => {
    expect(SSE_EVENT_TYPES).toEqual([
      "post.created",
      "response.started",
      "response.finished",
    ]);
  });

  it("requires common identity, room and timestamp metadata", () => {
    const event = {
      eventId: "0198b570-0000-7000-8000-000000000001",
      roomId: "room-1",
      type: "post.created",
      timestamp: "2026-08-17T00:00:00.000Z",
      postId: "post-1",
      threadRootId: "post-1",
    } satisfies PostCreatedEvent;

    expectTypeOf(event).toMatchTypeOf<SseEvent>();
    expect(event).not.toHaveProperty("thread");
  });
});

describe("Room API error contract", () => {
  it("exposes Room and membership errors without Simulation-specific codes", () => {
    expect(API_ERROR_CODES).toEqual(
      expect.arrayContaining(["room_archived", "room_not_found", "membership_required"]),
    );
    expect(API_ERROR_CODES.some((code) => code.includes("simulation"))).toBe(false);
    expectTypeOf<(typeof API_ERROR_CODES)[number]>().toEqualTypeOf<ApiErrorCode>();
  });
});
