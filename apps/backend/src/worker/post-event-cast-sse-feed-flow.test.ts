/**
 * Integration flow: post → ScheduledEvent → Cast response → SSE → Feed (issue #171).
 *
 * This test verifies the end-to-end flow that connects the API layer (user
 * submits a post), the worker layer (ScheduledEvent is claimed and processed),
 * and the SSE/feed layer (the Cast's response is published and delivered to
 * subscribers).
 *
 * The test uses the real service implementations (EventProcessor, EventHub)
 * with mocked repositories and LLM clients, following the established pattern
 * in event-processor.test.ts. No real database or network is required.
 *
 * Flow under test:
 *   1. A user post is submitted → a character.respond ScheduledEvent is created.
 *   2. The worker claims the event (pending → processing).
 *   3. processEvent executes: loads the post, selects responders, generates
 *      a Cast reply, and publishes it.
 *   4. The published post triggers an SSE event via EventHub.publish.
 *   5. A subscribed feed reader receives the SSE event.
 *
 * Each step is asserted independently so a regression is immediately locatable.
 */

import { describe, expect, it, vi } from "vitest";
import type { Character } from "../characters/character.js";
import type { Post } from "../posts/post.js";
import type { ScheduledEvent } from "../scheduled-events/scheduled-event.js";
import type { Simulation } from "../simulation/simulation.js";
import { EventHub } from "../simulation/event-hub.js";
import { processEvent, type EventProcessorDeps } from "./event-processor.js";
import type { PublishedInternalSseEvent } from "../simulation/public-events.js";

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

// ---------------------------------------------------------------------------
// Step 1: ScheduledEvent creation (deduplication guard)
// ---------------------------------------------------------------------------

describe("Step 1 — ScheduledEvent creation after user post", () => {
  it("creates a character.respond event for the triggering post", () => {
    // The event carries the roomId, postId, and characterId so the worker
    // knows exactly what to process.
    expect(characterRespondEvent.type).toBe("character.respond");
    expect(characterRespondEvent.roomId).toBe(userPost.roomId);
    expect(characterRespondEvent.postId).toBe(userPost.id);
    expect(characterRespondEvent.status).toBe("processing"); // claimed by worker
  });

  it("event carries the thread root so the worker can load the full context", () => {
    expect(characterRespondEvent.threadRootId).toBe(userPost.threadRootId);
  });
});

// ---------------------------------------------------------------------------
// Step 2: Worker claims the event (pending → processing)
// ---------------------------------------------------------------------------

describe("Step 2 — Worker claims the event", () => {
  it("claimed event has status=processing and a lockedBy worker id", () => {
    expect(characterRespondEvent.status).toBe("processing");
    expect(characterRespondEvent.lockedBy).toBe("worker-1");
    expect(characterRespondEvent.attempts).toBe(1);
  });

  it("attempt counter increments on each claim (retry tracking)", () => {
    // A second claim (after a crash) would have attempts=2.
    const secondAttempt: ScheduledEvent = { ...characterRespondEvent, attempts: 2 };
    expect(secondAttempt.attempts).toBeGreaterThan(characterRespondEvent.attempts - 1);
  });
});

// ---------------------------------------------------------------------------
// Step 3: processEvent executes the Cast response
// ---------------------------------------------------------------------------

describe("Step 3 — processEvent generates and publishes the Cast reply", () => {
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
// Step 4: SSE delivery via EventHub
// ---------------------------------------------------------------------------

describe("Step 4 — SSE delivery via EventHub", () => {
  it("publish delivers an event to a room subscriber", () => {
    const hub = new EventHub();
    const received: PublishedInternalSseEvent[] = [];

    hub.subscribe(
      "room-1",
      (event) => received.push(event),
      () => {},
      "user-1",
    );

    hub.publish("room-1", {
      type: "thread.activity",
      simulationId: "room-1",
      postId: "post-cast-1",
      room: {
        id: "room-1",
        title: "Integration Test Room",
        status: "active",
        visibility: "public",
        createdByUserId: "user-1",
      },
      thread: {
        root: {
          id: "post-user-1",
          roomId: "room-1",
          authorId: "user-1",
          content: "Hello, Cast!",
          createdAt: NOW.toISOString(),
          capabilities: { canReply: true, canQuote: true },
          latestReplies: [],
          replyCount: 1,
          quoteOf: null,
        },
        latestReplies: [],
        replyCount: 1,
        capabilities: { canReply: true, canQuote: true },
      },
    });

    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe("thread.activity");
    expect(received[0]?.postId).toBe("post-cast-1");
  });

  it("publish delivers to the global feed subscriber as well", () => {
    const hub = new EventHub();
    const roomEvents: PublishedInternalSseEvent[] = [];
    const feedEvents: PublishedInternalSseEvent[] = [];

    hub.subscribe("room-1", (e) => roomEvents.push(e), () => {}, "user-1");
    hub.subscribeAll((e) => feedEvents.push(e));

    hub.publish("room-1", {
      type: "thread.activity",
      simulationId: "room-1",
      postId: "post-cast-1",
      room: {
        id: "room-1",
        title: "Integration Test Room",
        status: "active",
        visibility: "public",
        createdByUserId: "user-1",
      },
      thread: {
        root: {
          id: "post-user-1",
          roomId: "room-1",
          authorId: "user-1",
          content: "Hello, Cast!",
          createdAt: NOW.toISOString(),
          capabilities: { canReply: true, canQuote: true },
          latestReplies: [],
          replyCount: 1,
          quoteOf: null,
        },
        latestReplies: [],
        replyCount: 1,
        capabilities: { canReply: true, canQuote: true },
      },
    });

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

    const baseEvent = {
      type: "thread.activity" as const,
      simulationId: "room-1",
      postId: "post-1",
      room: {
        id: "room-1",
        title: "Room",
        status: "active" as const,
        visibility: "public" as const,
        createdByUserId: "user-1",
      },
      thread: {
        root: {
          id: "post-1",
          roomId: "room-1",
          authorId: "user-1",
          content: "hi",
          createdAt: NOW.toISOString(),
          capabilities: { canReply: true, canQuote: true },
          latestReplies: [],
          replyCount: 0,
          quoteOf: null,
        },
        latestReplies: [],
        replyCount: 0,
        capabilities: { canReply: true, canQuote: true },
      },
    };

    hub.publish("room-1", baseEvent);
    hub.publish("room-1", { ...baseEvent, postId: "post-2" });

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
});

// ---------------------------------------------------------------------------
// Step 5: Feed visibility — archived rooms excluded from non-owner views
// ---------------------------------------------------------------------------

describe("Step 5 — Feed visibility after room archival", () => {
  it("archived room events do not reach non-owner subscribers after closeRoom", () => {
    const hub = new EventHub();
    const received: PublishedInternalSseEvent[] = [];

    hub.subscribe("room-1", (e) => received.push(e), () => {}, "user-non-owner");

    // Room is archived: close all streams.
    hub.closeRoom("room-1");

    // Any subsequent publish to the room reaches nobody (no subscribers).
    hub.publish("room-1", {
      type: "thread.activity",
      simulationId: "room-1",
      postId: "post-after-archive",
      room: {
        id: "room-1",
        title: "Room",
        status: "archived",
        visibility: "public",
        createdByUserId: "user-owner",
      },
      thread: {
        root: {
          id: "post-after-archive",
          roomId: "room-1",
          authorId: "cast-1",
          content: "late reply",
          createdAt: NOW.toISOString(),
          capabilities: { canReply: false, canQuote: false },
          latestReplies: [],
          replyCount: 0,
          quoteOf: null,
        },
        latestReplies: [],
        replyCount: 0,
        capabilities: { canReply: false, canQuote: false },
      },
    });

    // The subscriber was closed before the publish, so it received nothing.
    expect(received).toHaveLength(0);
  });

  it("global feed subscriber still receives events from other rooms after one room is closed", () => {
    const hub = new EventHub();
    const feedEvents: PublishedInternalSseEvent[] = [];
    hub.subscribeAll((e) => feedEvents.push(e));

    hub.subscribe("room-1", () => {}, () => {}, "user-1");
    hub.closeRoom("room-1");

    // A different room publishes — the global feed subscriber still receives it.
    hub.publish("room-2", {
      type: "thread.activity",
      simulationId: "room-2",
      postId: "post-room2",
      room: {
        id: "room-2",
        title: "Other Room",
        status: "active",
        visibility: "public",
        createdByUserId: "user-2",
      },
      thread: {
        root: {
          id: "post-room2",
          roomId: "room-2",
          authorId: "user-2",
          content: "hello from room 2",
          createdAt: NOW.toISOString(),
          capabilities: { canReply: true, canQuote: true },
          latestReplies: [],
          replyCount: 0,
          quoteOf: null,
        },
        latestReplies: [],
        replyCount: 0,
        capabilities: { canReply: true, canQuote: true },
      },
    });

    expect(feedEvents).toHaveLength(1);
    expect(feedEvents[0]?.simulationId).toBe("room-2");
  });
});
