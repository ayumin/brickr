import { GLOBAL_SIMULATION_ID, type FeedThreadDto, type PostDto } from "@brickr/shared";
import { describe, expect, it } from "vitest";
import type { InternalSseEvent } from "../simulation/public-events.js";
import type { FeedRoom } from "./feed-repository.js";
import type { FeedReader } from "./feed-service.js";
import { toPublicEvent } from "./public-events.js";

const ROOM: FeedRoom = {
  id: "room-1",
  title: "設計の部屋",
  status: "active",
  scope: "room",
  createdByUserId: "owner-1",
};

const READER: NonNullable<FeedReader> = { id: "reader-1", isAdmin: false, handle: "hanako" };

function post(id: string): PostDto {
  return {
    id,
    simulationId: ROOM.id,
    author: { id: "author-1", handle: "author_1", displayName: "著者" },
    content: "本文",
    mentions: [],
    replyTo: null,
    quoteOf: null,
    quotedPost: null,
    createdAt: "2026-08-13T10:00:00.000Z",
  };
}

function thread(overrides: Partial<FeedThreadDto> = {}): FeedThreadDto {
  return {
    root: post("root-1"),
    room: { id: ROOM.id, title: "設計の部屋", isFeed: false },
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
    ...overrides,
  };
}

function threadActivity(room: FeedRoom = ROOM): InternalSseEvent {
  return { type: "thread.activity", simulationId: room.id, room, thread: thread() };
}

describe("toPublicEvent thread activity (§11.3)", () => {
  it("publishes the thread and resolves capabilities for the subscriber", () => {
    const anonymous = toPublicEvent(threadActivity(), null);
    const signedIn = toPublicEvent(threadActivity(), READER);

    expect(anonymous).toMatchObject({ type: "feed.post-created" });
    expect(anonymous?.type === "feed.post-created" && anonymous.thread.capabilities).toEqual({
      canOpenAuthor: false,
      canOpenRoom: false,
      canOpenThread: false,
      canReply: false,
      canQuote: false,
      canLoadMoreReplies: false,
    });
    expect(signedIn?.type === "feed.post-created" && signedIn.thread.capabilities).toEqual({
      canOpenAuthor: true,
      canOpenRoom: true,
      canOpenThread: true,
      canReply: true,
      canQuote: true,
      canLoadMoreReplies: true,
    });
  });

  /** Everything except capabilities is identical for everyone (§10.1). */
  it("gives every subscriber the same thread contents", () => {
    const anonymous = toPublicEvent(threadActivity(), null);
    const signedIn = toPublicEvent(threadActivity(), READER);

    if (anonymous?.type !== "feed.post-created" || signedIn?.type !== "feed.post-created") {
      throw new Error("expected feed.post-created");
    }
    expect({ ...anonymous.thread, capabilities: null }).toEqual({
      ...signedIn.thread,
      capabilities: null,
    });
  });

  it("never offers to open the feed as a room", () => {
    const feedRoom: FeedRoom = { id: GLOBAL_SIMULATION_ID, title: "フィード", status: "active", scope: "global" };

    const event = toPublicEvent(threadActivity(feedRoom), READER);

    expect(event?.type === "feed.post-created" && event.thread.capabilities.canOpenRoom).toBe(
      false,
    );
  });

  /** A stopped room can still receive an update through a repair or a backfill. */
  it("keeps a stopped room's thread unwritable, and readable only for its owner", () => {
    const stopped: FeedRoom = { ...ROOM, status: "archived" };

    const stranger = toPublicEvent(threadActivity(stopped), READER);
    const owner = toPublicEvent(threadActivity(stopped), {
      id: "owner-1",
      isAdmin: false,
      handle: "owner",
    });

    expect(stranger?.type === "feed.post-created" && stranger.thread.capabilities).toMatchObject({
      canReply: false,
      canOpenThread: false,
    });
    expect(owner?.type === "feed.post-created" && owner.thread.capabilities).toMatchObject({
      canReply: false,
      canOpenThread: true,
    });
  });
});

describe("toPublicEvent response activity (§11.2)", () => {
  const started: InternalSseEvent = {
    type: "response.started",
    simulationId: ROOM.id,
    activityId: "activity-1",
    targetPostId: "root-1",
    threadRootId: "root-1",
  };

  it("passes the activity through, and nothing else", () => {
    expect(toPublicEvent(started, READER)).toEqual({
      type: "response.started",
      activityId: "activity-1",
      simulationId: ROOM.id,
      targetPostId: "root-1",
      threadRootId: "root-1",
    });
  });

  it("reports how a response ended, never why", () => {
    const finished = toPublicEvent(
      { ...started, type: "response.finished", outcome: "failed" },
      READER,
    );

    expect(finished).toEqual({
      type: "response.finished",
      activityId: "activity-1",
      simulationId: ROOM.id,
      targetPostId: "root-1",
      threadRootId: "root-1",
      outcome: "failed",
    });
  });
});

describe("toPublicEvent internal events (§11.4)", () => {
  /**
   * The default of this boundary is silence: an event nobody mapped is dropped
   * rather than forwarded, so adding one cannot leak by accident.
   */
  const internal: InternalSseEvent[] = [
    {
      type: "generation.completed",
      simulationId: ROOM.id,
      triggerPostId: "root-1",
      generatedPostIds: ["post-2"],
    },
    { type: "generation.failed", simulationId: ROOM.id, reason: "provider unavailable" },
  ];

  it.each(internal)("drops $type instead of publishing it", (event) => {
    expect(toPublicEvent(event, READER)).toBeNull();
    expect(toPublicEvent(event, null)).toBeNull();
  });
});

describe("public event privacy (§25)", () => {
  /**
   * The guarantee the feed's anonymity rests on: whatever a subscriber receives,
   * it cannot be matched against a character.
   */
  it("contains no character identity, model or failure reason", () => {
    const events: InternalSseEvent[] = [
      threadActivity(),
      {
        type: "response.started",
        simulationId: ROOM.id,
        activityId: "activity-1",
        targetPostId: "root-1",
        threadRootId: "root-1",
      },
      {
        type: "response.finished",
        simulationId: ROOM.id,
        activityId: "activity-1",
        targetPostId: "root-1",
        threadRootId: "root-1",
        outcome: "failed",
      },
      { type: "generation.failed", simulationId: ROOM.id, reason: "gpt-4o rate limited" },
    ];

    const published = events
      .flatMap((event) => [toPublicEvent(event, READER), toPublicEvent(event, null)])
      .filter((event) => event !== null);
    const payload = JSON.stringify(published);

    for (const forbidden of [
      "characterId",
      "handle:",
      "displayName:",
      "providerId",
      "model",
      "reason",
      "rate limited",
    ]) {
      expect(payload, forbidden).not.toContain(forbidden);
    }
  });
});
