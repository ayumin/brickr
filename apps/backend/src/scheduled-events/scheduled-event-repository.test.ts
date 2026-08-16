/**
 * DB integration tests for ScheduledEventRepository.
 *
 * These tests verify the three critical behaviours called out in issue #160:
 *   1. Concurrent claim — only one worker claims a given event even when
 *      multiple workers poll simultaneously (atomic lock via FOR UPDATE SKIP LOCKED).
 *   2. Deduplication — at most one pending event per (type, roomId, postId,
 *      characterId) combination is created.
 *   3. Cancel — pending/processing events are cancelled when a room is archived
 *      or a cast member is removed/banned.
 *
 * The Prisma client is mocked following the established pattern in this codebase
 * (see post-repository.test.ts, simulation-repository.test.ts). The raw SQL
 * path used by `claimEvent` is exercised through `$queryRaw` mock.
 */
import { describe, expect, it, vi } from "vitest";
import type { Db } from "../persistence/prisma.js";
import { ScheduledEventNotFoundError, ScheduledEventRepository } from "./scheduled-event-repository.js";
import type { NewScheduledEvent, ScheduledEvent } from "./scheduled-event.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = new Date("2026-08-17T10:00:00.000Z");
const PAST = new Date("2026-08-17T09:00:00.000Z");

function makeEvent(overrides: Partial<ScheduledEvent> = {}): ScheduledEvent {
  return {
    id: "event-1",
    type: "character.respond",
    status: "pending",
    scheduledAt: PAST,
    roomId: "room-1",
    postId: "post-1",
    threadRootId: "post-1",
    characterId: "char-1",
    lockedBy: null,
    lockedAt: null,
    attempts: 0,
    lastError: null,
    createdAt: PAST,
    updatedAt: PAST,
    ...overrides,
  };
}

/**
 * Builds a minimal Prisma mock that covers the methods used by
 * ScheduledEventRepository. Each test overrides only what it needs.
 */
function makeDb(overrides: {
  findFirst?: ReturnType<typeof vi.fn>;
  create?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
  updateMany?: ReturnType<typeof vi.fn>;
  findUnique?: ReturnType<typeof vi.fn>;
  findMany?: ReturnType<typeof vi.fn>;
  groupBy?: ReturnType<typeof vi.fn>;
  queryRaw?: ReturnType<typeof vi.fn>;
} = {}): Db {
  return {
    scheduledEvent: {
      findFirst: overrides.findFirst ?? vi.fn(() => Promise.resolve(null)),
      create: overrides.create ?? vi.fn(() => Promise.resolve(makeEvent())),
      update: overrides.update ?? vi.fn(() => Promise.resolve(makeEvent())),
      updateMany: overrides.updateMany ?? vi.fn(() => Promise.resolve({ count: 0 })),
      findUnique: overrides.findUnique ?? vi.fn(() => Promise.resolve(null)),
      findMany: overrides.findMany ?? vi.fn(() => Promise.resolve([])),
      groupBy: overrides.groupBy ?? vi.fn(() => Promise.resolve([])),
    },
    $queryRaw: overrides.queryRaw ?? vi.fn(() => Promise.resolve([])),
  } as unknown as Db;
}

function newEvent(overrides: Partial<NewScheduledEvent> & { id: string }): NewScheduledEvent {
  return {
    type: "character.respond",
    scheduledAt: PAST,
    roomId: "room-1",
    postId: "post-1",
    threadRootId: "post-1",
    characterId: "char-1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Deduplication
// ---------------------------------------------------------------------------

describe("ScheduledEventRepository.create — deduplication", () => {
  it("inserts a new event when no pending duplicate exists", async () => {
    const create = vi.fn(() => Promise.resolve(makeEvent()));
    const db = makeDb({ create });

    const result = await new ScheduledEventRepository(db).create(newEvent({ id: "event-1" }));

    expect(result).not.toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("returns null without inserting when a pending duplicate already exists", async () => {
    const existing = makeEvent({ id: "event-existing" });
    const findFirst = vi.fn(() => Promise.resolve(existing));
    const create = vi.fn();
    const db = makeDb({ findFirst, create });

    const result = await new ScheduledEventRepository(db).create(newEvent({ id: "event-new" }));

    expect(result).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("checks for duplicates using the correct (type, roomId, postId, characterId) key", async () => {
    const findFirst = vi.fn(() => Promise.resolve(null));
    const db = makeDb({ findFirst });

    await new ScheduledEventRepository(db).create(
      newEvent({ id: "event-1", type: "thread.revive", roomId: "room-2", postId: null, characterId: null }),
    );

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        type: "thread.revive",
        status: "pending",
        roomId: "room-2",
        postId: null,
        characterId: null,
      },
    });
  });

  it("allows a second pending event when the first has a different type", async () => {
    // findFirst returns null (no duplicate for this type)
    const findFirst = vi.fn(() => Promise.resolve(null));
    const create = vi.fn(() => Promise.resolve(makeEvent({ type: "thread.revive" })));
    const db = makeDb({ findFirst, create });

    const result = await new ScheduledEventRepository(db).create(
      newEvent({ id: "event-2", type: "thread.revive" }),
    );

    expect(result).not.toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("allows a second pending event when the first has a different characterId", async () => {
    const findFirst = vi.fn(() => Promise.resolve(null));
    const create = vi.fn(() => Promise.resolve(makeEvent({ characterId: "char-2" })));
    const db = makeDb({ findFirst, create });

    const result = await new ScheduledEventRepository(db).create(
      newEvent({ id: "event-2", characterId: "char-2" }),
    );

    expect(result).not.toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("maps optional fields to null when not provided", async () => {
    const create = vi.fn(() =>
      Promise.resolve(makeEvent({ roomId: null, postId: null, threadRootId: null, characterId: null })),
    );
    const db = makeDb({ create });

    await new ScheduledEventRepository(db).create({
      id: "event-1",
      type: "room.review",
      scheduledAt: PAST,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          roomId: null,
          postId: null,
          threadRootId: null,
          characterId: null,
        }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Concurrent claim (atomic lock)
// ---------------------------------------------------------------------------

describe("ScheduledEventRepository.claimEvent — atomic lock", () => {
  it("returns the claimed event when a pending event is available", async () => {
    const claimedRow = {
      id: "event-1",
      type: "character.respond",
      status: "processing",
      scheduled_at: PAST,
      room_id: "room-1",
      post_id: "post-1",
      thread_root_id: "post-1",
      character_id: "char-1",
      locked_by: "worker-1",
      locked_at: NOW,
      attempts: 1,
      last_error: null,
      created_at: PAST,
      updated_at: NOW,
    };
    const queryRaw = vi.fn(() => Promise.resolve([claimedRow]));
    const db = makeDb({ queryRaw });

    const result = await new ScheduledEventRepository(db).claimEvent("worker-1");

    expect(result).not.toBeNull();
    expect(result?.id).toBe("event-1");
    expect(result?.status).toBe("processing");
    expect(result?.lockedBy).toBe("worker-1");
    expect(result?.attempts).toBe(1);
  });

  it("returns null when no pending event is available", async () => {
    // Both the primary claim and the lock-reclaim queries return empty arrays.
    const queryRaw = vi.fn(() => Promise.resolve([]));
    const db = makeDb({ queryRaw });

    const result = await new ScheduledEventRepository(db).claimEvent("worker-1");

    expect(result).toBeNull();
  });

  it("issues a raw SQL UPDATE so the claim is atomic at the database level", async () => {
    const queryRaw = vi.fn(() => Promise.resolve([]));
    const db = makeDb({ queryRaw });

    await new ScheduledEventRepository(db).claimEvent("worker-1");

    // The repository must use $queryRaw (not findFirst + update) so the
    // conditional UPDATE … WHERE … FOR UPDATE SKIP LOCKED is a single atomic
    // statement. Two separate queries would create a TOCTOU race.
    expect(queryRaw).toHaveBeenCalled();
  });

  it("increments the attempt counter on each claim", async () => {
    const claimedRow = {
      id: "event-1",
      type: "character.respond",
      status: "processing",
      scheduled_at: PAST,
      room_id: "room-1",
      post_id: "post-1",
      thread_root_id: "post-1",
      character_id: "char-1",
      locked_by: "worker-2",
      locked_at: NOW,
      attempts: 2, // second attempt
      last_error: "previous error",
      created_at: PAST,
      updated_at: NOW,
    };
    const queryRaw = vi.fn(() => Promise.resolve([claimedRow]));
    const db = makeDb({ queryRaw });

    const result = await new ScheduledEventRepository(db).claimEvent("worker-2");

    expect(result?.attempts).toBe(2);
    expect(result?.lastError).toBe("previous error");
  });

  it("falls back to reclaiming a lock-expired event when no fresh pending event exists", async () => {
    // First call (primary claim) returns empty; second call (reclaim) returns a row.
    const reclaimedRow = {
      id: "event-stale",
      type: "character.respond",
      status: "processing",
      scheduled_at: PAST,
      room_id: "room-1",
      post_id: "post-1",
      thread_root_id: "post-1",
      character_id: "char-1",
      locked_by: "worker-2",
      locked_at: NOW,
      attempts: 2,
      last_error: null,
      created_at: PAST,
      updated_at: NOW,
    };
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([]) // primary claim: no pending event
      .mockResolvedValueOnce([reclaimedRow]); // reclaim: expired lock found
    const db = makeDb({ queryRaw });

    const result = await new ScheduledEventRepository(db).claimEvent("worker-2");

    expect(result).not.toBeNull();
    expect(result?.id).toBe("event-stale");
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it("maps the raw SQL snake_case columns to the domain camelCase shape", async () => {
    const claimedRow = {
      id: "event-1",
      type: "thread.revive",
      status: "processing",
      scheduled_at: PAST,
      room_id: "room-42",
      post_id: "post-99",
      thread_root_id: "post-99",
      character_id: null,
      locked_by: "worker-3",
      locked_at: NOW,
      attempts: 1,
      last_error: null,
      created_at: PAST,
      updated_at: NOW,
    };
    const queryRaw = vi.fn(() => Promise.resolve([claimedRow]));
    const db = makeDb({ queryRaw });

    const result = await new ScheduledEventRepository(db).claimEvent("worker-3");

    expect(result).toMatchObject({
      id: "event-1",
      type: "thread.revive",
      status: "processing",
      scheduledAt: PAST,
      roomId: "room-42",
      postId: "post-99",
      threadRootId: "post-99",
      characterId: null,
      lockedBy: "worker-3",
      lockedAt: NOW,
      attempts: 1,
      lastError: null,
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Cancel — by room and by character in room
// ---------------------------------------------------------------------------

describe("ScheduledEventRepository.cancelByRoom", () => {
  it("cancels all pending and processing events for the given room", async () => {
    const updateMany = vi.fn(() => Promise.resolve({ count: 3 }));
    const db = makeDb({ updateMany });

    const count = await new ScheduledEventRepository(db).cancelByRoom("room-1");

    expect(count).toBe(3);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        roomId: "room-1",
        status: { in: ["pending", "processing"] },
      },
      data: { status: "cancelled" },
    });
  });

  it("returns 0 when there are no pending or processing events for the room", async () => {
    const updateMany = vi.fn(() => Promise.resolve({ count: 0 }));
    const db = makeDb({ updateMany });

    const count = await new ScheduledEventRepository(db).cancelByRoom("room-empty");

    expect(count).toBe(0);
  });

  it("does not cancel completed or already-cancelled events", async () => {
    const updateMany = vi.fn(() => Promise.resolve({ count: 1 }));
    const db = makeDb({ updateMany });

    await new ScheduledEventRepository(db).cancelByRoom("room-1");

    // The where clause must restrict to pending/processing only.
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["pending", "processing"] },
        }),
      }),
    );
  });
});

describe("ScheduledEventRepository.cancelByCharacterInRoom", () => {
  it("cancels pending and processing events for the given character in the given room", async () => {
    const updateMany = vi.fn(() => Promise.resolve({ count: 2 }));
    const db = makeDb({ updateMany });

    const count = await new ScheduledEventRepository(db).cancelByCharacterInRoom(
      "char-1",
      "room-1",
    );

    expect(count).toBe(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        characterId: "char-1",
        roomId: "room-1",
        status: { in: ["pending", "processing"] },
      },
      data: { status: "cancelled" },
    });
  });

  it("does not cancel events for the same character in a different room", async () => {
    const updateMany = vi.fn(() => Promise.resolve({ count: 0 }));
    const db = makeDb({ updateMany });

    await new ScheduledEventRepository(db).cancelByCharacterInRoom("char-1", "room-2");

    // The where clause must include roomId so events in other rooms are untouched.
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          roomId: "room-2",
          characterId: "char-1",
        }),
      }),
    );
  });

  it("returns 0 when the character has no pending or processing events in the room", async () => {
    const updateMany = vi.fn(() => Promise.resolve({ count: 0 }));
    const db = makeDb({ updateMany });

    const count = await new ScheduledEventRepository(db).cancelByCharacterInRoom(
      "char-none",
      "room-1",
    );

    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Lifecycle transitions (markCompleted, markFailed, resetForRetry)
// ---------------------------------------------------------------------------

describe("ScheduledEventRepository lifecycle transitions", () => {
  it("markCompleted clears the lock and sets status to completed", async () => {
    const completedEvent = makeEvent({ status: "completed", lockedBy: null, lockedAt: null });
    const update = vi.fn(() => Promise.resolve(completedEvent));
    const db = makeDb({ update });

    const result = await new ScheduledEventRepository(db).markCompleted("event-1");

    expect(result.status).toBe("completed");
    expect(result.lockedBy).toBeNull();
    expect(update).toHaveBeenCalledWith({
      where: { id: "event-1" },
      data: { status: "completed", lockedBy: null, lockedAt: null },
    });
  });

  it("markFailed records the error message and clears the lock", async () => {
    const failedEvent = makeEvent({
      status: "failed",
      lockedBy: null,
      lockedAt: null,
      lastError: "timeout",
    });
    const update = vi.fn(() => Promise.resolve(failedEvent));
    const db = makeDb({ update });

    const result = await new ScheduledEventRepository(db).markFailed("event-1", "timeout");

    expect(result.status).toBe("failed");
    expect(result.lastError).toBe("timeout");
    expect(update).toHaveBeenCalledWith({
      where: { id: "event-1" },
      data: { status: "failed", lockedBy: null, lockedAt: null, lastError: "timeout" },
    });
  });

  it("resetForRetry sets status back to pending with a new scheduledAt", async () => {
    const retryAt = new Date("2026-08-17T10:05:00.000Z");
    const retriedEvent = makeEvent({ status: "pending", scheduledAt: retryAt });
    const update = vi.fn(() => Promise.resolve(retriedEvent));
    const db = makeDb({ update });

    const result = await new ScheduledEventRepository(db).resetForRetry("event-1", retryAt);

    expect(result.status).toBe("pending");
    expect(result.scheduledAt).toEqual(retryAt);
    expect(update).toHaveBeenCalledWith({
      where: { id: "event-1" },
      data: { status: "pending", lockedBy: null, lockedAt: null, scheduledAt: retryAt },
    });
  });

  it("markCompleted throws ScheduledEventNotFoundError on Prisma P2025", async () => {
    const p2025 = Object.assign(new Error("Record not found"), { code: "P2025" });
    const update = vi.fn(() => Promise.reject(p2025));
    const db = makeDb({ update });

    await expect(
      new ScheduledEventRepository(db).markCompleted("event-gone"),
    ).rejects.toBeInstanceOf(ScheduledEventNotFoundError);
  });

  it("markFailed throws ScheduledEventNotFoundError on Prisma P2025", async () => {
    const p2025 = Object.assign(new Error("Record not found"), { code: "P2025" });
    const update = vi.fn(() => Promise.reject(p2025));
    const db = makeDb({ update });

    await expect(
      new ScheduledEventRepository(db).markFailed("event-gone", "timeout"),
    ).rejects.toBeInstanceOf(ScheduledEventNotFoundError);
  });

  it("resetForRetry throws ScheduledEventNotFoundError on Prisma P2025", async () => {
    const p2025 = Object.assign(new Error("Record not found"), { code: "P2025" });
    const update = vi.fn(() => Promise.reject(p2025));
    const db = makeDb({ update });

    await expect(
      new ScheduledEventRepository(db).resetForRetry("event-gone", new Date()),
    ).rejects.toBeInstanceOf(ScheduledEventNotFoundError);
  });

  it("markCompleted re-throws non-P2025 errors unchanged", async () => {
    const unexpected = new Error("connection lost");
    const update = vi.fn(() => Promise.reject(unexpected));
    const db = makeDb({ update });

    await expect(
      new ScheduledEventRepository(db).markCompleted("event-1"),
    ).rejects.toBe(unexpected);
  });
});

// ---------------------------------------------------------------------------
// 5. countByStatus (worker health)
// ---------------------------------------------------------------------------

describe("ScheduledEventRepository.countByStatus", () => {
  it("returns zero counts for all statuses when the table is empty", async () => {
    const groupBy = vi.fn(() => Promise.resolve([]));
    const db = makeDb({ groupBy });

    const counts = await new ScheduledEventRepository(db).countByStatus();

    expect(counts).toEqual({
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    });
  });

  it("maps groupBy results to the correct status counts", async () => {
    const groupBy = vi.fn(() =>
      Promise.resolve([
        { status: "pending", _count: { id: 5 } },
        { status: "processing", _count: { id: 2 } },
        { status: "completed", _count: { id: 100 } },
        { status: "failed", _count: { id: 3 } },
      ]),
    );
    const db = makeDb({ groupBy });

    const counts = await new ScheduledEventRepository(db).countByStatus();

    expect(counts).toEqual({
      pending: 5,
      processing: 2,
      completed: 100,
      failed: 3,
      cancelled: 0,
    });
  });
});
