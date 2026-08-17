/**
 * Quality coverage for worker event processing and EventHub delivery (issue #171).
 *
 * The worker and API processes do not share an EventHub, so these production
 * boundaries are exercised independently with their real implementations and
 * mocked repositories/LLM clients. ScheduledEvent creation and claim semantics
 * are covered by scheduled-event-lifecycle.test.ts; the archive route's
 * RoomService → EventHub.closeRoom wiring is covered by rooms-routes.test.ts.
 */

import { describe, expect, it, vi } from "vitest";
import type { Character } from "../characters/character.js";
import type { Post } from "../posts/post.js";
import type { ScheduledEvent } from "../scheduled-events/scheduled-event.js";
import type { Simulation } from "../simulation/simulation.js";
import { EventHub } from "../simulation/event-hub.js";
import { processEvent, type EventProcessorDeps } from "./event-processor.js";
import type {
  InternalSseEvent,
  PublishedInternalSseEvent,
} from "../simulation/public-events.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date("2026-08-17T00:00:00.000Z");

const character: Character = {
  id: "cast-1",
  handle: "responder",
  displayName: "Responder",
  description: "desc",
  rolePrompt: "role",
  tonePrompt: "tone",
  interests: [],
  activityLevel: 1,
  responseProbability: 1,
  replyProbability: 1,
  quoteProbability: 0,
  influence: 0,
  modelProfileId: "profile-1",
};

const activeRoom: Simulation = {
  id: "room-1",
  title: "Integration Test Room",
  status: "active",
  scope: "room",
  visibility: "public",
  tags: [],
  createdAt: NOW,
  lastActivityAt: NOW,
  createdByUserId: "user-1",
};

const userPost: Post = {
  id: "post-user-1",
  roomId: "room-1",
  authorId: "user-1",
  content: "Hello, Cast!",
  mentions: [],
  replyTo: null,
  quoteOf: null,
  threadRootId: "post-user-1",
  threadActivityAt: NOW,
  createdAt: NOW,
};

const castReply: Post = {
  id: "post-cast-1",
  roomId: "room-1",
  authorId: "cast-1",
  content: "Hello, user!",
  mentions: [],
  replyTo: "post-user-1",
  quoteOf: null,
  threadRootId: "post-user-1",
  threadActivityAt: NOW,
  createdAt: NOW,
};

const characterRespondEvent: ScheduledEvent = {
  id: "event-1",
  type: "character.respond",
  status: "processing",
  scheduledAt: NOW,
  roomId: "room-1",
  postId: "post-user-1",
  threadRootId: "post-user-1",
  characterId: "cast-1",
  lockedBy: "worker-1",
  lockedAt: NOW,
  attempts: 1,
  lastError: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const feedCapabilities = {
  canOpenAuthor: true,
  canOpenRoom: true,
  canOpenThread: true,
  canReply: true,
  canQuote: true,
  canLoadMoreReplies: false,
};

function threadActivityEvent(options: {
  roomId?: string;
  postId?: string;
  status?: "active" | "archived";
} = {}): InternalSseEvent {
  const roomId = options.roomId ?? "room-1";
  const postId = options.postId ?? "post-cast-1";
  const status = options.status ?? "active";
  return {
    type: "thread.activity",
    simulationId: roomId,
    postId,
    room: {
      id: roomId,
      title: "Integration Test Room",
      status,
      scope: "room",
      visibility: "public",
      createdByUserId: "user-1",
    },
    thread: {
      root: {
        id: "post-user-1",
        roomId,
        author: { id: "user-1", handle: "user_1", displayName: "User" },
        content: "Hello, Cast!",
        mentions: [],
        replyTo: null,
        quoteOf: null,
        quotedPost: null,
        createdAt: NOW.toISOString(),
      },
      room: { id: roomId, title: "Integration Test Room" },
      latestReplies: [],
      replyCount: 1,
      lastActivityAt: NOW.toISOString(),
      capabilities: {
        ...feedCapabilities,
        canOpenRoom: status === "active",
        canReply: status === "active",
        canQuote: status === "active",
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Step 1: processEvent executes the Cast response
// ---------------------------------------------------------------------------

describe("Step 1 — processEvent generates and publishes the Cast reply", () => {
  function makeDeps(overrides: Partial<EventProcessorDeps> = {}): {
    deps: EventProcessorDeps;
    publish: ReturnType<typeof vi.fn>;
    logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  } {
    const publish = vi.fn(() => Promise.resolve(castReply));
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const deps: EventProcessorDeps = {
      simulations: { findById: () => Promise.resolve(activeRoom) },
      characters: {
        findAll: () => Promise.resolve([character]),
        findById: () => Promise.resolve(character),
      },
      memberships: {
        findActiveCastIds: () => Promise.resolve([]),
        findPendingCastIds: () => Promise.resolve([]),
        findBannedCastIds: () => Promise.resolve([]),
        countPendingCasts: () => Promise.resolve(0),
        countActiveRoomsForCast: () => Promise.resolve(0),
        create: vi.fn(),
      },
      posts: {
        findById: () => Promise.resolve(userPost),
        findUsersByIds: () => Promise.resolve([]),
        findDormantThreadRoots: () => Promise.resolve([]),
        publish,
      },
      threads: {
        getCurrentThread: () =>
          Promise.resolve({ target: userPost, posts: [userPost] }),
      },
      agents: {
        generate: () =>
          Promise.resolve({
            content: "Hello, user!",
            action: "reply",
            providerId: "mock",
            model: "test",
          }),
      },
      llm: {
        generate: () =>
          Promise.resolve({
            text: JSON.stringify({ shouldJoin: false, reason: "test" }),
            providerId: "mock",
            model: "test",
          }),
      },
      providers: { preferred: () => null },
      scheduledEvents: { create: vi.fn(() => Promise.resolve(null)) },
      logger,
      ...overrides,
    } as unknown as EventProcessorDeps;

    return { deps, publish, logger };
  }

  it("publishes the Cast reply when the LLM generates successfully", async () => {
    const { deps, publish } = makeDeps();

    await processEvent(characterRespondEvent, deps);

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: "room-1",
        authorId: "cast-1",
        content: "Hello, user!",
      }),
    );
  });

  it("skips processing when the trigger post no longer exists (deleted after scheduling)", async () => {
    const publishFn = vi.fn(() => Promise.resolve(castReply));
    const { deps, logger } = makeDeps({
      posts: {
        findById: () => Promise.resolve(null),
        findUsersByIds: () => Promise.resolve([]),
        findDormantThreadRoots: () => Promise.resolve([]),
        publish: publishFn,
      } as unknown as EventProcessorDeps["posts"],
    });

    await processEvent(characterRespondEvent, deps);

    expect(publishFn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ postId: "post-user-1" }),
      "trigger post no longer exists — skipping",
    );
  });

  it("skips processing when the room is archived (archived after scheduling)", async () => {
    const { deps, publish, logger } = makeDeps({
      simulations: {
        findById: () =>
          Promise.resolve({ ...activeRoom, status: "archived" }),
      } as unknown as EventProcessorDeps["simulations"],
    });

    await processEvent(characterRespondEvent, deps);

    expect(publish).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: "room-1" }),
      "room is archived or deleted — skipping",
    );
  });

  it("throws when all responders fail so the worker retries the event", async () => {
    const { deps, publish } = makeDeps({
      agents: {
        generate: () => Promise.reject(new Error("LLM unavailable")),
      } as unknown as EventProcessorDeps["agents"],
    });

    await expect(processEvent(characterRespondEvent, deps)).rejects.toThrow(
      "all 1 responders failed for event event-1",
    );
    expect(publish).not.toHaveBeenCalled();
  });

  it("logs a warning for a failed generation attempt", async () => {
    // The character fails on the first (and only) attempt.
    // The worker logs a warning and then throws (all responders failed).
    const { deps, publish, logger } = makeDeps({
      agents: {
        generate: () => Promise.reject(new Error("LLM rate limited")),
      } as unknown as EventProcessorDeps["agents"],
    });

    // All responders failed → the worker throws so it can retry.
    await expect(processEvent(characterRespondEvent, deps)).rejects.toThrow(
      "all 1 responders failed",
    );
    expect(publish).not.toHaveBeenCalled();
    // The per-character failure is logged at warn level.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: "LLM rate limited" }),
      "character generation failed in worker",
    );
  });
});

// ---------------------------------------------------------------------------
// Step 2: SSE delivery via EventHub
// ---------------------------------------------------------------------------

describe("Step 2 — SSE delivery via EventHub", () => {
  it("publish delivers an event to a room subscriber", () => {
    const hub = new EventHub();
    const received: PublishedInternalSseEvent[] = [];

    hub.subscribe(
      "room-1",
      (event) => received.push(event),
      () => {},
      "user-1",
    );

    hub.publish("room-1", threadActivityEvent());

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: "thread.activity", postId: "post-cast-1" });
  });

  it("publish delivers to the global feed subscriber as well", () => {
    const hub = new EventHub();
    const roomEvents: PublishedInternalSseEvent[] = [];
    const feedEvents: PublishedInternalSseEvent[] = [];

    hub.subscribe("room-1", (e) => roomEvents.push(e), () => {}, "user-1");
    hub.subscribeAll((e) => feedEvents.push(e));

    hub.publish("room-1", threadActivityEvent());

    // Both the room subscriber and the global feed subscriber receive the event.
    expect(roomEvents).toHaveLength(1);
    expect(feedEvents).toHaveLength(1);
    // They receive the same event object (same eventId).
    expect(roomEvents[0]?.eventId).toBe(feedEvents[0]?.eventId);
  });

  it("each published event gets a unique eventId", () => {
    const hub = new EventHub();
    const received: PublishedInternalSseEvent[] = [];
    hub.subscribeAll((e) => received.push(e));

    hub.publish("room-1", threadActivityEvent({ postId: "post-1" }));
    hub.publish("room-1", threadActivityEvent({ postId: "post-2" }));

    expect(received).toHaveLength(2);
    expect(received[0]?.eventId).not.toBe(received[1]?.eventId);
  });

  it("closeRoom terminates all room subscribers (visibility re-evaluation)", () => {
    const hub = new EventHub();
    let closed = false;

    hub.subscribe("room-1", () => {}, () => { closed = true; }, "user-1");
    expect(hub.subscriberCount("room-1")).toBe(1);

    hub.closeRoom("room-1");

    expect(closed).toBe(true);
    expect(hub.subscriberCount("room-1")).toBe(0);
  });

  it("closeSubscriber terminates only the revoked member's streams", () => {
    const hub = new EventHub();
    let user1Closed = false;
    let user2Closed = false;

    hub.subscribe("room-1", () => {}, () => { user1Closed = true; }, "user-1");
    hub.subscribe("room-1", () => {}, () => { user2Closed = true; }, "user-2");
    expect(hub.subscriberCount("room-1")).toBe(2);

    hub.closeSubscriber("room-1", "user-1");

    expect(user1Closed).toBe(true);
    expect(user2Closed).toBe(false);
    expect(hub.subscriberCount("room-1")).toBe(1);
  });

  it("closing one room does not interrupt the global feed subscriber", () => {
    const hub = new EventHub();
    const feedEvents: PublishedInternalSseEvent[] = [];
    hub.subscribeAll((e) => feedEvents.push(e));

    hub.subscribe("room-1", () => {}, () => {}, "user-1");
    hub.closeRoom("room-1");

    // A different room publishes — the global feed subscriber still receives it.
    hub.publish("room-2", threadActivityEvent({ roomId: "room-2", postId: "post-room2" }));

    expect(feedEvents).toHaveLength(1);
    expect(feedEvents[0]?.simulationId).toBe("room-2");
  });
});
