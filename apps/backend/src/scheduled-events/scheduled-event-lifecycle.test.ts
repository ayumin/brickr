/**
 * ScheduledEvent claim / retry / recovery / cancel lifecycle tests (issue #171).
 *
 * Covers the full state machine for a scheduled event:
 *
 *   pending → processing  (claim)
 *   processing → completed (markCompleted)
 *   processing → failed    (markFailed)
 *   failed → pending       (resetForRetry — retry)
 *   processing → cancelled (cancelByRoom — recovery when room archived mid-flight)
 *   pending → cancelled    (cancelByRoom / cancelByCharacterInRoom)
 *
 * The repository is tested with a Prisma mock following the established pattern
 * in this codebase. The focus here is on the lifecycle transitions and the
 * business rules that govern them, not on the SQL syntax (which is covered in
 * scheduled-event-repository.test.ts).
 */

import { describe, expect, it, vi } from "vitest";
import type { Db } from "../persistence/prisma.js";
import {
  ScheduledEventNotFoundError,
  ScheduledEventRepository,
} from "./scheduled-event-repository.js";
import type { NewScheduledEvent, ScheduledEvent } from "./scheduled-event.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = new Date("2026-08-17T10:00:00.000Z");
const PAST = new Date("2026-08-17T09:00:00.000Z");
const RETRY_AT = new Date("2026-08-17T10:05:00.000Z");

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
// Claim lifecycle
// ---------------------------------------------------------------------------

describe("ScheduledEvent claim lifecycle", () => {
  it("transitions pending → processing on a successful claim", async () => {
    const processingRow = {
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
    const queryRaw = vi.fn(() => Promise.resolve([processingRow]));
    const repo = new ScheduledEventRepository(makeDb({ queryRaw }));

    const claimed = await repo.claimEvent("worker-1");

    expect(claimed).not.toBeNull();
    expect(claimed?.status).toBe("processing");
    expect(claimed?.lockedBy).toBe("worker-1");
    expect(claimed?.attempts).toBe(1);
  });

  it("returns null when no pending event is available (queue empty)", async () => {
    const queryRaw = vi.fn(() => Promise.resolve([]));
    const repo = new ScheduledEventRepository(makeDb({ queryRaw }));

    const claimed = await repo.claimEvent("worker-1");

    expect(claimed).toBeNull();
  });

  it("reclaims a stale lock from a crashed worker", async () => {
    // Primary claim returns nothing; reclaim path finds the stale event.
    const staleRow = {
      id: "event-stale",
      type: "thread.revive",
      status: "processing",
      scheduled_at: PAST,
      room_id: "room-1",
      post_id: null,
      thread_root_id: null,
      character_id: null,
      locked_by: "worker-crashed",
      locked_at: new Date("2026-08-17T04:00:00.000Z"), // > 5 min ago
      attempts: 1,
      last_error: null,
      created_at: PAST,
      updated_at: PAST,
    };
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([]) // primary claim: no fresh pending event
      .mockResolvedValueOnce([staleRow]); // reclaim: expired lock found
    const repo = new ScheduledEventRepository(makeDb({ queryRaw }));

    const claimed = await repo.claimEvent("worker-2");

    expect(claimed).not.toBeNull();
    expect(claimed?.id).toBe("event-stale");
    // Two raw SQL calls: one for fresh pending, one for stale lock reclaim.
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it("increments the attempt counter on each claim (retry tracking)", async () => {
    const secondAttemptRow = {
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
      attempts: 2,
      last_error: "previous timeout",
      created_at: PAST,
      updated_at: NOW,
    };
    const queryRaw = vi.fn(() => Promise.resolve([secondAttemptRow]));
    const repo = new ScheduledEventRepository(makeDb({ queryRaw }));

    const claimed = await repo.claimEvent("worker-1");

    expect(claimed?.attempts).toBe(2);
    expect(claimed?.lastError).toBe("previous timeout");
  });
});

// ---------------------------------------------------------------------------
// Completion lifecycle
// ---------------------------------------------------------------------------

describe("ScheduledEvent completion lifecycle", () => {
  it("transitions processing → completed and clears the lock", async () => {
    const completedEvent = makeEvent({
      status: "completed",
      lockedBy: null,
      lockedAt: null,
      attempts: 1,
    });
    const update = vi.fn(() => Promise.resolve(completedEvent));
    const repo = new ScheduledEventRepository(makeDb({ update }));

    const result = await repo.markCompleted("event-1");

    expect(result.status).toBe("completed");
    expect(result.lockedBy).toBeNull();
    expect(result.lockedAt).toBeNull();
    expect(update).toHaveBeenCalledWith({
      where: { id: "event-1" },
      data: { status: "completed", lockedBy: null, lockedAt: null },
    });
  });

  it("throws ScheduledEventNotFoundError when the event was concurrently cancelled", async () => {
    const p2025 = Object.assign(new Error("Record not found"), { code: "P2025" });
    const update = vi.fn(() => Promise.reject(p2025));
    const repo = new ScheduledEventRepository(makeDb({ update }));

    await expect(repo.markCompleted("event-gone")).rejects.toBeInstanceOf(
      ScheduledEventNotFoundError,
    );
  });

  it("re-throws non-P2025 errors unchanged (unexpected DB failure)", async () => {
    const unexpected = new Error("connection reset");
    const update = vi.fn(() => Promise.reject(unexpected));
    const repo = new ScheduledEventRepository(makeDb({ update }));

    await expect(repo.markCompleted("event-1")).rejects.toBe(unexpected);
  });
});

// ---------------------------------------------------------------------------
// Failure and retry lifecycle
// ---------------------------------------------------------------------------

describe("ScheduledEvent failure and retry lifecycle", () => {
  it("transitions processing → failed and records the error message", async () => {
    const failedEvent = makeEvent({
      status: "failed",
      lockedBy: null,
      lockedAt: null,
      lastError: "LLM timeout after 30s",
      attempts: 1,
    });
    const update = vi.fn(() => Promise.resolve(failedEvent));
    const repo = new ScheduledEventRepository(makeDb({ update }));

    const result = await repo.markFailed("event-1", "LLM timeout after 30s");

    expect(result.status).toBe("failed");
    expect(result.lastError).toBe("LLM timeout after 30s");
    expect(result.lockedBy).toBeNull();
    expect(update).toHaveBeenCalledWith({
      where: { id: "event-1" },
      data: {
        status: "failed",
        lockedBy: null,
        lockedAt: null,
        lastError: "LLM timeout after 30s",
      },
    });
  });

  it("transitions failed → pending for retry with a future scheduledAt", async () => {
    const retriedEvent = makeEvent({
      status: "pending",
      scheduledAt: RETRY_AT,
      lockedBy: null,
      lockedAt: null,
      attempts: 1,
    });
    const update = vi.fn(() => Promise.resolve(retriedEvent));
    const repo = new ScheduledEventRepository(makeDb({ update }));

    const result = await repo.resetForRetry("event-1", RETRY_AT);

    expect(result.status).toBe("pending");
    expect(result.scheduledAt).toEqual(RETRY_AT);
    expect(update).toHaveBeenCalledWith({
      where: { id: "event-1" },
      data: {
        status: "pending",
        lockedBy: null,
        lockedAt: null,
        scheduledAt: RETRY_AT,
      },
    });
  });

  it("throws ScheduledEventNotFoundError on retry when the event was deleted", async () => {
    const p2025 = Object.assign(new Error("Record not found"), { code: "P2025" });
    const update = vi.fn(() => Promise.reject(p2025));
    const repo = new ScheduledEventRepository(makeDb({ update }));

    await expect(repo.resetForRetry("event-gone", RETRY_AT)).rejects.toBeInstanceOf(
      ScheduledEventNotFoundError,
    );
  });

  it("throws ScheduledEventNotFoundError on markFailed when the event was deleted", async () => {
    const p2025 = Object.assign(new Error("Record not found"), { code: "P2025" });
    const update = vi.fn(() => Promise.reject(p2025));
    const repo = new ScheduledEventRepository(makeDb({ update }));

    await expect(repo.markFailed("event-gone", "error")).rejects.toBeInstanceOf(
      ScheduledEventNotFoundError,
    );
  });
});

// ---------------------------------------------------------------------------
// Cancellation (room archived / character removed)
// ---------------------------------------------------------------------------

describe("ScheduledEvent cancellation — room archived", () => {
  it("cancels all pending and processing events for the room", async () => {
    const updateMany = vi.fn(() => Promise.resolve({ count: 4 }));
    const repo = new ScheduledEventRepository(makeDb({ updateMany }));

    const count = await repo.cancelByRoom("room-1");

    expect(count).toBe(4);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        roomId: "room-1",
        status: { in: ["pending", "processing"] },
      },
      data: { status: "cancelled" },
    });
  });

  it("does not cancel completed or already-cancelled events", async () => {
    const updateMany = vi.fn(() => Promise.resolve({ count: 2 }));
    const repo = new ScheduledEventRepository(makeDb({ updateMany }));

    await repo.cancelByRoom("room-1");

    // The where clause must restrict to pending/processing only.
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["pending", "processing"] },
        }),
      }),
    );
  });

  it("returns 0 when the room has no pending or processing events", async () => {
    const updateMany = vi.fn(() => Promise.resolve({ count: 0 }));
    const repo = new ScheduledEventRepository(makeDb({ updateMany }));

    const count = await repo.cancelByRoom("room-empty");

    expect(count).toBe(0);
  });

  it("cancels a processing event that a worker holds mid-flight (room archived while worker runs)", async () => {
    // The worker claimed the event (status = processing) and the room was
    // archived before the worker finished. cancelByRoom must cancel it.
    const updateMany = vi.fn(() => Promise.resolve({ count: 1 }));
    const repo = new ScheduledEventRepository(makeDb({ updateMany }));

    const count = await repo.cancelByRoom("room-1");

    expect(count).toBe(1);
    // "processing" is included in the status filter.
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["pending", "processing"] },
        }),
      }),
    );
  });
});

describe("ScheduledEvent cancellation — character removed or banned", () => {
  it("cancels pending and processing events for the character in the room", async () => {
    const updateMany = vi.fn(() => Promise.resolve({ count: 2 }));
    const repo = new ScheduledEventRepository(makeDb({ updateMany }));

    const count = await repo.cancelByCharacterInRoom("char-1", "room-1");

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
    const repo = new ScheduledEventRepository(makeDb({ updateMany }));

    await repo.cancelByCharacterInRoom("char-1", "room-2");

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          roomId: "room-2",
          characterId: "char-1",
        }),
      }),
    );
  });

  it("does not cancel events for a different character in the same room", async () => {
    const updateMany = vi.fn(() => Promise.resolve({ count: 0 }));
    const repo = new ScheduledEventRepository(makeDb({ updateMany }));

    await repo.cancelByCharacterInRoom("char-other", "room-1");

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          characterId: "char-other",
          roomId: "room-1",
        }),
      }),
    );
  });

  it("returns 0 when the character has no pending or processing events in the room", async () => {
    const updateMany = vi.fn(() => Promise.resolve({ count: 0 }));
    const repo = new ScheduledEventRepository(makeDb({ updateMany }));

    const count = await repo.cancelByCharacterInRoom("char-none", "room-1");

    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Deduplication (prevents double-scheduling)
// ---------------------------------------------------------------------------

describe("ScheduledEvent deduplication", () => {
  it("returns null without inserting when a pending duplicate already exists", async () => {
    const existing = makeEvent({ id: "event-existing" });
    const findFirst = vi.fn(() => Promise.resolve(existing));
    const create = vi.fn();
    const repo = new ScheduledEventRepository(makeDb({ findFirst, create }));

    const result = await repo.create(newEvent({ id: "event-new" }));

    expect(result).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("inserts when no pending duplicate exists", async () => {
    const create = vi.fn(() => Promise.resolve(makeEvent()));
    const repo = new ScheduledEventRepository(makeDb({ create }));

    const result = await repo.create(newEvent({ id: "event-1" }));

    expect(result).not.toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("allows a second event when the first has a different type", async () => {
    const findFirst = vi.fn(() => Promise.resolve(null));
    const create = vi.fn(() => Promise.resolve(makeEvent({ type: "thread.revive" })));
    const repo = new ScheduledEventRepository(makeDb({ findFirst, create }));

    const result = await repo.create(
      newEvent({ id: "event-2", type: "thread.revive" }),
    );

    expect(result).not.toBeNull();
  });

  it("allows a second event when the first has a different characterId", async () => {
    const findFirst = vi.fn(() => Promise.resolve(null));
    const create = vi.fn(() => Promise.resolve(makeEvent({ characterId: "char-2" })));
    const repo = new ScheduledEventRepository(makeDb({ findFirst, create }));

    const result = await repo.create(
      newEvent({ id: "event-2", characterId: "char-2" }),
    );

    expect(result).not.toBeNull();
  });

  it("checks deduplication using (type, roomId, postId, characterId) as the key", async () => {
    const findFirst = vi.fn(() => Promise.resolve(null));
    const repo = new ScheduledEventRepository(makeDb({ findFirst }));

    await repo.create(
      newEvent({
        id: "event-1",
        type: "room.review",
        roomId: "room-99",
        postId: null,
        characterId: null,
      }),
    );

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        type: "room.review",
        status: "pending",
        roomId: "room-99",
        postId: null,
        characterId: null,
      },
    });
  });
});

// ---------------------------------------------------------------------------
// Worker health: countByStatus
// ---------------------------------------------------------------------------

describe("ScheduledEvent worker health — countByStatus", () => {
  it("returns zero counts for all statuses when the queue is empty", async () => {
    const groupBy = vi.fn(() => Promise.resolve([]));
    const repo = new ScheduledEventRepository(makeDb({ groupBy }));

    const counts = await repo.countByStatus();

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
        { status: "pending", _count: { id: 7 } },
        { status: "processing", _count: { id: 1 } },
        { status: "completed", _count: { id: 200 } },
        { status: "failed", _count: { id: 3 } },
        { status: "cancelled", _count: { id: 12 } },
      ]),
    );
    const repo = new ScheduledEventRepository(makeDb({ groupBy }));

    const counts = await repo.countByStatus();

    expect(counts).toEqual({
      pending: 7,
      processing: 1,
      completed: 200,
      failed: 3,
      cancelled: 12,
    });
  });

  it("omits statuses not present in the groupBy result (defaults to 0)", async () => {
    const groupBy = vi.fn(() =>
      Promise.resolve([{ status: "pending", _count: { id: 5 } }]),
    );
    const repo = new ScheduledEventRepository(makeDb({ groupBy }));

    const counts = await repo.countByStatus();

    expect(counts.pending).toBe(5);
    expect(counts.processing).toBe(0);
    expect(counts.completed).toBe(0);
    expect(counts.failed).toBe(0);
    expect(counts.cancelled).toBe(0);
  });
});
