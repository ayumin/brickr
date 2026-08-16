import type { FeedThreadDto, PostDto } from "@brickr/shared";
import { describe, expect, it } from "vitest";
import type {
  InternalSseEvent,
  PublishedInternalSseEvent,
} from "../simulation/public-events.js";
import type { FeedRoom } from "./feed-repository.js";
import { toPublicEvent } from "./public-events.js";

const ROOM: FeedRoom = {
  id: "room-1",
  title: "設計の部屋",
  status: "active",
  scope: "room",
  createdByUserId: "owner-1",
};

const EVENT_ID = "0198b570-0000-7000-8000-000000000001";
const TIMESTAMP = "2026-08-17T00:00:00.000Z";

function post(id: string): PostDto {
  return {
    id,
    roomId: ROOM.id,
    author: { id: "author-1", handle: "author_1", displayName: "著者" },
    content: "本文",
    mentions: [],
    replyTo: null,
    quoteOf: null,
    quotedPost: null,
    createdAt: "2026-08-13T10:00:00.000Z",
  };
}

function thread(): FeedThreadDto {
  return {
    root: post("root-1"),
    room: { id: ROOM.id, title: "設計の部屋" },
    latestReplies: [post("reply-1")],
    replyCount: 3,
    lastActivityAt: "2026-08-13T10:05:00.000Z",
    capabilities: {
      canOpenAuthor: false,
      canOpenRoom: false,
      canOpenThread: false,
      canReply: false,
      canQuote: false,
      canLoadMoreReplies: false,
    },
  };
}

function published(event: InternalSseEvent): PublishedInternalSseEvent {
  return { ...event, eventId: EVENT_ID, timestamp: TIMESTAMP };
}

function threadActivity(): PublishedInternalSseEvent {
  return published({
    type: "thread.activity",
    simulationId: ROOM.id,
    postId: "reply-1",
    room: ROOM,
    thread: thread(),
  });
}

describe("toPublicEvent state changes", () => {
  it("publishes only identifiers for a created post", () => {
    expect(toPublicEvent(threadActivity())).toEqual({
      eventId: EVENT_ID,
      roomId: ROOM.id,
      type: "post.created",
      timestamp: TIMESTAMP,
      postId: "reply-1",
      threadRootId: "root-1",
    });
  });

  it("passes minimal response activity state through", () => {
    const started = published({
      type: "response.started",
      simulationId: ROOM.id,
      activityId: "activity-1",
      targetPostId: "root-1",
      threadRootId: "root-1",
    });

    expect(toPublicEvent(started)).toEqual({
      eventId: EVENT_ID,
      roomId: ROOM.id,
      type: "response.started",
      timestamp: TIMESTAMP,
      activityId: "activity-1",
      targetPostId: "root-1",
      threadRootId: "root-1",
    });
    const finished = published({
      type: "response.finished",
      simulationId: ROOM.id,
      activityId: "activity-1",
      targetPostId: "root-1",
      threadRootId: "root-1",
      outcome: "failed",
    });
    expect(toPublicEvent(finished)).toEqual({
      eventId: EVENT_ID,
      roomId: ROOM.id,
      type: "response.finished",
      timestamp: TIMESTAMP,
      activityId: "activity-1",
      targetPostId: "root-1",
      threadRootId: "root-1",
      outcome: "failed",
    });
  });

  it("drops internal-only events", () => {
    const internal: InternalSseEvent[] = [
      {
        type: "generation.completed",
        simulationId: ROOM.id,
        triggerPostId: "root-1",
        generatedPostIds: ["post-2"],
      },
      { type: "generation.failed", simulationId: ROOM.id, reason: "provider unavailable" },
    ];

    for (const event of internal) {
      expect(toPublicEvent(published(event))).toBeNull();
    }
  });

  it("contains no post body, character identity, model, or failure reason", () => {
    const payload = JSON.stringify(toPublicEvent(threadActivity()));

    for (const forbidden of [
      "本文",
      "author_1",
      "characterId",
      "displayName",
      "providerId",
      "model",
      "reason",
    ]) {
      expect(payload, forbidden).not.toContain(forbidden);
    }
  });
});
