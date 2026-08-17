/**
 * Unit tests for the room review service (issue #165).
 *
 * All external dependencies are mocked so the tests run without a database or
 * LLM provider.
 */
import { describe, expect, it, vi } from "vitest";
import type { Post } from "../posts/post.js";
import type { Simulation } from "../simulation/simulation.js";
import { reviewRoom, type RoomReviewDeps } from "./room-review-service.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = new Date("2026-08-17T12:00:00.000Z");

const room: Simulation = {
  id: "room-1",
  title: "Test Room",
  status: "active",
  visibility: "public",
  scope: "room",
  tags: [],
  createdAt: now,
  lastActivityAt: now,
  createdByUserId: "user-1",
};

const dormantPost: Post = {
  id: "post-dormant",
  roomId: "room-1",
  authorId: "user-1",
  content: "This thread has gone quiet",
  mentions: [],
  replyTo: null,
  quoteOf: null,
  threadRootId: "post-dormant",
  threadActivityAt: new Date(now.getTime() - 3 * 60 * 60 * 1_000), // 3 hours ago
  createdAt: new Date(now.getTime() - 3 * 60 * 60 * 1_000),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<RoomReviewDeps> = {}): RoomReviewDeps {
  return {
    simulations: {
      findById: vi.fn(() => Promise.resolve(room)),
    } as unknown as RoomReviewDeps["simulations"],
    memberships: {
      findActiveCastIds: vi.fn(() => Promise.resolve(["char-1"])),
    } as unknown as RoomReviewDeps["memberships"],
    posts: {
      findDormantThreadRoots: vi.fn(() => Promise.resolve([dormantPost])),
    } as unknown as RoomReviewDeps["posts"],
    scheduledEvents: {
      create: vi.fn(() => Promise.resolve({ id: "new-event", type: "thread.revive" })),
    } as unknown as RoomReviewDeps["scheduledEvents"],
    logger: { warn: vi.fn() },
    clock: () => now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("reviewRoom", () => {
  it("returns skipped when the room is archived", async () => {
    const deps = makeDeps({
      simulations: {
        findById: vi.fn(() => Promise.resolve({ ...room, status: "archived" })),
      } as unknown as RoomReviewDeps["simulations"],
    });

    const result = await reviewRoom("room-1", deps);

    expect(result.revivalsScheduled).toBe(0);
    expect(result.skippedReason).toContain("archived");
  });

  it("returns skipped when the room does not exist", async () => {
    const deps = makeDeps({
      simulations: {
        findById: vi.fn(() => Promise.resolve(null)),
      } as unknown as RoomReviewDeps["simulations"],
    });

    const result = await reviewRoom("room-1", deps);

    expect(result.revivalsScheduled).toBe(0);
    expect(result.skippedReason).toBeDefined();
  });

  it("returns skipped when no active Cast members exist", async () => {
    const deps = makeDeps({
      memberships: {
        findActiveCastIds: vi.fn(() => Promise.resolve([])),
      } as unknown as RoomReviewDeps["memberships"],
    });

    const result = await reviewRoom("room-1", deps);

    expect(result.revivalsScheduled).toBe(0);
    expect(result.skippedReason).toContain("no active Cast");
  });

  it("returns skipped when no dormant threads exist", async () => {
    const deps = makeDeps({
      posts: {
        findDormantThreadRoots: vi.fn(() => Promise.resolve([])),
      } as unknown as RoomReviewDeps["posts"],
    });

    const result = await reviewRoom("room-1", deps);

    expect(result.revivalsScheduled).toBe(0);
    expect(result.skippedReason).toContain("no dormant threads");
  });

  it("schedules a thread.revive event for each dormant thread", async () => {
    const create = vi.fn((_input: { scheduledAt: Date }) =>
      Promise.resolve({ id: "new-event", type: "thread.revive" }),
    );
    const deps = makeDeps({
      scheduledEvents: { create } as unknown as RoomReviewDeps["scheduledEvents"],
    });

    const result = await reviewRoom("room-1", deps);

    expect(result.revivalsScheduled).toBe(1);
    expect(result.skippedReason).toBeUndefined();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "thread.revive",
        roomId: "room-1",
        postId: dormantPost.id,
        threadRootId: dormantPost.id,
        characterId: null,
      }),
    );
  });

  it("schedules multiple revivals when multiple dormant threads exist", async () => {
    const dormantPost2: Post = {
      ...dormantPost,
      id: "post-dormant-2",
    };
    const create = vi.fn(() =>
      Promise.resolve({ id: "new-event", type: "thread.revive" }),
    );
    const deps = makeDeps({
      posts: {
        findDormantThreadRoots: vi.fn(() => Promise.resolve([dormantPost, dormantPost2])),
      } as unknown as RoomReviewDeps["posts"],
      scheduledEvents: { create } as unknown as RoomReviewDeps["scheduledEvents"],
    });

    const result = await reviewRoom("room-1", deps);

    expect(result.revivalsScheduled).toBe(2);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("logs an individual scheduling failure and continues with later threads", async () => {
    const dormantPost2: Post = {
      ...dormantPost,
      id: "post-dormant-2",
      threadRootId: "post-dormant-2",
    };
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error("queue unavailable"))
      .mockResolvedValueOnce({ id: "new-event", type: "thread.revive" });
    const logger = { warn: vi.fn() };
    const deps = makeDeps({
      posts: {
        findDormantThreadRoots: vi.fn(() => Promise.resolve([dormantPost, dormantPost2])),
      } as unknown as RoomReviewDeps["posts"],
      scheduledEvents: { create } as unknown as RoomReviewDeps["scheduledEvents"],
      logger,
    });

    const result = await reviewRoom("room-1", deps);

    expect(result.revivalsScheduled).toBe(1);
    expect(create).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: "room-1", threadRootId: dormantPost.id }),
      "failed to schedule thread revival; continuing room review",
    );
  });

  it("does not count a revival when the repository returns null (duplicate)", async () => {
    // Repository returns null when a pending event already exists (deduplication)
    const create = vi.fn(() => Promise.resolve(null));
    const deps = makeDeps({
      scheduledEvents: { create } as unknown as RoomReviewDeps["scheduledEvents"],
    });

    const result = await reviewRoom("room-1", deps);

    expect(result.revivalsScheduled).toBe(0);
    expect(result.skippedReason).toBeUndefined();
    // The review still completed — it just found no new events to schedule
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("schedules revivals with a future scheduledAt", async () => {
    const create = vi.fn((_input: { scheduledAt: Date }) =>
      Promise.resolve({ id: "new-event", type: "thread.revive" }),
    );
    const deps = makeDeps({
      scheduledEvents: { create } as unknown as RoomReviewDeps["scheduledEvents"],
    });

    await reviewRoom("room-1", deps);

    const [input] = create.mock.calls[0]!;
    expect(input.scheduledAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it("uses the injected clock to compute the dormant threshold", async () => {
    const customNow = new Date("2026-01-01T00:00:00.000Z");
    const findDormantThreadRoots = vi.fn(
      (_roomId: string, _dormantBefore: Date, _limit: number) => Promise.resolve([]),
    );
    const deps = makeDeps({
      clock: () => customNow,
      posts: {
        findDormantThreadRoots,
      } as unknown as RoomReviewDeps["posts"],
    });

    await reviewRoom("room-1", deps);

    expect(findDormantThreadRoots).toHaveBeenCalledWith(
      "room-1",
      expect.any(Date),
      expect.any(Number),
    );
    const [, dormantBefore] = findDormantThreadRoots.mock.calls[0]!;
    // dormantBefore should be customNow - DORMANT_THRESHOLD_MS
    expect(dormantBefore.getTime()).toBeLessThan(customNow.getTime());
  });

  it("generates a unique id for each scheduled event", async () => {
    const dormantPost2: Post = { ...dormantPost, id: "post-dormant-2" };
    const create = vi.fn(() =>
      Promise.resolve({ id: "new-event", type: "thread.revive" }),
    );
    const deps = makeDeps({
      posts: {
        findDormantThreadRoots: vi.fn(() => Promise.resolve([dormantPost, dormantPost2])),
      } as unknown as RoomReviewDeps["posts"],
      scheduledEvents: { create } as unknown as RoomReviewDeps["scheduledEvents"],
    });

    await reviewRoom("room-1", deps);

    const ids = create.mock.calls.map((call: unknown[]) => (call[0] as { id: string }).id);
    expect(new Set(ids).size).toBe(ids.length); // all unique
  });
});
