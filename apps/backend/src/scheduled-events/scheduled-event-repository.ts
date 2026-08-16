import { DomainError } from "../domain-error.js";
import { Prisma, isRecordNotFoundError, type Db } from "../persistence/prisma.js";
import type {
  EventStatus,
  NewScheduledEvent,
  ScheduledEvent,
  ScheduledEventType,
} from "./scheduled-event.js";

/**
 * Raised by `markCompleted`, `markFailed`, and `resetForRetry` when the event
 * no longer exists at the time of the update — e.g. it was concurrently
 * cancelled or reclaimed and then deleted. Callers should treat this as a
 * no-op rather than a fatal error.
 */
export class ScheduledEventNotFoundError extends DomainError {
  readonly httpStatus = 404;
  readonly errorCode = "not_found" as const;
  constructor(id: string) {
    super(`scheduled event "${id}" not found`);
  }
}

/**
 * How long a worker lock is considered valid before another worker may reclaim
 * the event. Matches the worker's own timeout so a crashed worker's events are
 * recovered promptly.
 */
const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Raw SQL row returned by `$queryRaw`. Postgres returns snake_case column names.
 */
type RawScheduledEventRow = {
  id: string;
  type: string;
  status: string;
  scheduled_at: Date;
  room_id: string | null;
  post_id: string | null;
  thread_root_id: string | null;
  character_id: string | null;
  locked_by: string | null;
  locked_at: Date | null;
  attempts: number;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
};

/**
 * Converts a raw SQL row (snake_case) to the camelCase shape that
 * `fromPrismaRow` expects, so a single mapper handles both code paths.
 */
function rawToPrismaShape(row: RawScheduledEventRow): PrismaScheduledEventRow {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    scheduledAt: row.scheduled_at,
    roomId: row.room_id,
    postId: row.post_id,
    threadRootId: row.thread_root_id,
    characterId: row.character_id,
    lockedBy: row.locked_by,
    lockedAt: row.locked_at,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Prisma-shaped row returned by `findUnique` / `findFirst` / `create` / `update`.
 * Prisma uses camelCase column names in its result objects.
 */
type PrismaScheduledEventRow = {
  id: string;
  type: string;
  status: string;
  scheduledAt: Date;
  roomId: string | null;
  postId: string | null;
  threadRootId: string | null;
  characterId: string | null;
  lockedBy: string | null;
  lockedAt: Date | null;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function fromPrismaRow(row: PrismaScheduledEventRow): ScheduledEvent {
  return {
    id: row.id,
    type: row.type as ScheduledEventType,
    status: row.status as EventStatus,
    scheduledAt: row.scheduledAt,
    roomId: row.roomId,
    postId: row.postId,
    threadRootId: row.threadRootId,
    characterId: row.characterId,
    lockedBy: row.lockedBy,
    lockedAt: row.lockedAt,
    attempts: row.attempts,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class ScheduledEventRepository {
  constructor(private readonly db: Db) {}

  /**
   * Creates a new pending event.
   *
   * Deduplication: if a pending event with the same (type, roomId, postId,
   * characterId) already exists, returns null instead of inserting a duplicate.
   * This prevents the same logical action from being queued twice.
   */
  async create(input: NewScheduledEvent): Promise<ScheduledEvent | null> {
    // Check for an existing pending event with the same logical identity.
    // A partial unique index (only for pending) cannot be expressed in Prisma
    // schema, so we enforce deduplication here in the application layer.
    const existing = await this.db.scheduledEvent.findFirst({
      where: {
        type: input.type,
        status: "pending",
        roomId: input.roomId ?? null,
        postId: input.postId ?? null,
        characterId: input.characterId ?? null,
      },
    });
    if (existing) return null;

    const row = await this.db.scheduledEvent.create({
      data: {
        id: input.id,
        type: input.type,
        status: "pending",
        scheduledAt: input.scheduledAt,
        roomId: input.roomId ?? null,
        postId: input.postId ?? null,
        threadRootId: input.threadRootId ?? null,
        characterId: input.characterId ?? null,
        lockedBy: null,
        lockedAt: null,
        attempts: 0,
        lastError: null,
      },
    });
    return fromPrismaRow(row);
  }

  /**
   * Atomically claims one pending event whose scheduled time has arrived.
   *
   * Uses a raw SQL UPDATE … WHERE … RETURNING with FOR UPDATE SKIP LOCKED so
   * that concurrent workers never claim the same event. The conditional WHERE
   * clause also reclaims events whose lock has expired (crashed workers).
   *
   * Returns the claimed event, or null if no eligible event is available.
   *
   * Note: FOR UPDATE SKIP LOCKED is PostgreSQL-specific. If portability to
   * other databases is ever required, replace with an optimistic-concurrency
   * approach (compare-and-swap on a version column).
   */
  async claimEvent(workerId: string): Promise<ScheduledEvent | null> {
    const now = new Date();
    const lockExpiry = new Date(now.getTime() - LOCK_TIMEOUT_MS);

    // The subquery selects the id of one eligible event with SKIP LOCKED so
    // concurrent workers skip rows already held by another transaction.
    // The outer UPDATE atomically transitions it to processing.
    const rows = await this.db.$queryRaw<RawScheduledEventRow[]>(
      Prisma.sql`
        UPDATE scheduled_events
        SET
          status    = 'processing',
          locked_by = ${workerId},
          locked_at = ${now},
          attempts  = attempts + 1,
          updated_at = ${now}
        WHERE id = (
          SELECT id
          FROM scheduled_events
          WHERE
            status = 'pending'
            AND scheduled_at <= ${now}
          ORDER BY scheduled_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING
          id,
          type,
          status,
          scheduled_at,
          room_id,
          post_id,
          thread_root_id,
          character_id,
          locked_by,
          locked_at,
          attempts,
          last_error,
          created_at,
          updated_at
      `,
    );

    // Also reclaim events whose lock has expired (crashed workers).
    // Run as a separate query so the primary claim path stays simple.
    if (rows.length === 0) {
      const reclaimed = await this.db.$queryRaw<RawScheduledEventRow[]>(
        Prisma.sql`
          UPDATE scheduled_events
          SET
            status    = 'processing',
            locked_by = ${workerId},
            locked_at = ${now},
            attempts  = attempts + 1,
            updated_at = ${now}
          WHERE id = (
            SELECT id
            FROM scheduled_events
            WHERE
              status = 'processing'
              AND locked_at <= ${lockExpiry}
            ORDER BY locked_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )
          RETURNING
            id,
            type,
            status,
            scheduled_at,
            room_id,
            post_id,
            thread_root_id,
            character_id,
            locked_by,
            locked_at,
            attempts,
            last_error,
            created_at,
            updated_at
        `,
      );
      return reclaimed.length > 0 ? fromPrismaRow(rawToPrismaShape(reclaimed[0]!)) : null;
    }

    return fromPrismaRow(rawToPrismaShape(rows[0]!));
  }

  /**
   * Marks an event as completed. Called by the worker after successful execution.
   *
   * Throws `ScheduledEventNotFoundError` if the event no longer exists (e.g. it
   * was concurrently cancelled between the worker claiming it and finishing).
   */
  async markCompleted(id: string): Promise<ScheduledEvent> {
    try {
      const row = await this.db.scheduledEvent.update({
        where: { id },
        data: { status: "completed", lockedBy: null, lockedAt: null },
      });
      return fromPrismaRow(row);
    } catch (error) {
      if (isRecordNotFoundError(error)) throw new ScheduledEventNotFoundError(id);
      throw error;
    }
  }

  /**
   * Marks an event as failed and records the error. The worker decides whether
   * to retry (by resetting to pending) based on the attempt count.
   *
   * Throws `ScheduledEventNotFoundError` if the event no longer exists.
   */
  async markFailed(id: string, error: string): Promise<ScheduledEvent> {
    try {
      const row = await this.db.scheduledEvent.update({
        where: { id },
        data: { status: "failed", lockedBy: null, lockedAt: null, lastError: error },
      });
      return fromPrismaRow(row);
    } catch (err) {
      if (isRecordNotFoundError(err)) throw new ScheduledEventNotFoundError(id);
      throw err;
    }
  }

  /**
   * Resets a failed event to pending for retry. The caller is responsible for
   * checking the attempt count before calling this.
   *
   * Throws `ScheduledEventNotFoundError` if the event no longer exists.
   */
  async resetForRetry(id: string, scheduledAt: Date): Promise<ScheduledEvent> {
    try {
      const row = await this.db.scheduledEvent.update({
        where: { id },
        data: { status: "pending", lockedBy: null, lockedAt: null, scheduledAt },
      });
      return fromPrismaRow(row);
    } catch (error) {
      if (isRecordNotFoundError(error)) throw new ScheduledEventNotFoundError(id);
      throw error;
    }
  }

  /**
   * Cancels all pending and processing events for a room.
   *
   * Called when a room is archived or deleted (design spec §9: "Room が
   * archived / 削除済みなら未実行 event は cancelled").
   *
   * Returns the number of events cancelled.
   */
  async cancelByRoom(roomId: string): Promise<number> {
    const result = await this.db.scheduledEvent.updateMany({
      where: {
        roomId,
        status: { in: ["pending", "processing"] },
      },
      data: { status: "cancelled" },
    });
    return result.count;
  }

  /**
   * Cancels pending and processing events for a specific character in a room.
   *
   * Called when a cast member is removed or banned from a room (design spec §9:
   * "Cast が removed / banned になった時点で、その Cast・Room の未実行
   * character.respond、character.join.welcome、参加関連 event を即 cancelled").
   *
   * Returns the number of events cancelled.
   */
  async cancelByCharacterInRoom(characterId: string, roomId: string): Promise<number> {
    const result = await this.db.scheduledEvent.updateMany({
      where: {
        characterId,
        roomId,
        status: { in: ["pending", "processing"] },
      },
      data: { status: "cancelled" },
    });
    return result.count;
  }

  /** Finds a single event by id. */
  async findById(id: string): Promise<ScheduledEvent | null> {
    const row = await this.db.scheduledEvent.findUnique({ where: { id } });
    return row ? fromPrismaRow(row) : null;
  }

  /**
   * Returns pending events for a room, ordered by scheduled time.
   * Useful for worker health checks and debugging.
   */
  async findPendingByRoom(roomId: string): Promise<ScheduledEvent[]> {
    const rows = await this.db.scheduledEvent.findMany({
      where: { roomId, status: "pending" },
      orderBy: { scheduledAt: "asc" },
    });
    return rows.map(fromPrismaRow);
  }

  /**
   * Counts events by status for worker health reporting (design spec §9:
   * "worker health として最終ポーリング時刻、最終成功時刻、滞留 event 数を提供").
   */
  async countByStatus(): Promise<Record<EventStatus, number>> {
    const counts = await this.db.scheduledEvent.groupBy({
      by: ["status"],
      _count: { id: true },
    });

    const result: Record<EventStatus, number> = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    for (const row of counts) {
      result[row.status as EventStatus] = row._count.id;
    }

    return result;
  }
}
