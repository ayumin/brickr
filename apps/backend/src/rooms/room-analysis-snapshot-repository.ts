/**
 * Persistence layer for room analysis snapshots (issue #166).
 *
 * One row per room — the unique constraint on `roomId` ensures only the latest
 * attempt is kept. Failed writes preserve the prior successful summary and its
 * post coordinates so callers still have a last-known-good snapshot.
 */
import type { SnapshotStatus } from "@brickr/shared";
import type { Db } from "../persistence/prisma.js";

export type RoomAnalysisSnapshot = {
  id: string;
  roomId: string;
  postCount: number;
  latestPostId: string | null;
  summary: string | null;
  status: SnapshotStatus;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type SnapshotRow = {
  id: string;
  roomId: string;
  postCount: number;
  latestPostId: string | null;
  summary: string | null;
  status: string;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toSnapshot(row: SnapshotRow): RoomAnalysisSnapshot {
  return {
    id: row.id,
    roomId: row.roomId,
    postCount: row.postCount,
    latestPostId: row.latestPostId,
    summary: row.summary,
    status: row.status as SnapshotStatus,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type UpsertSnapshotInput = {
  roomId: string;
  postCount: number;
  latestPostId: string | null;
  summary: string | null;
  status: SnapshotStatus;
  error: string | null;
};

export class RoomAnalysisSnapshotRepository {
  constructor(private readonly db: Db) {}

  /** Returns the snapshot for a room, or null if none exists yet. */
  async findByRoom(roomId: string): Promise<RoomAnalysisSnapshot | null> {
    const row = await this.db.roomAnalysisSnapshot.findUnique({
      where: { roomId },
    });
    return row ? toSnapshot(row) : null;
  }

  /**
   * Upserts the snapshot for a room.
   *
   * Because only one snapshot is kept per room (unique on `roomId`), this
   * A completed attempt replaces the analysis fields. A failed attempt updates
   * only status/error, preserving the previous completed analysis when one
   * exists. The `id` and `createdAt` remain stable across both paths.
   */
  async upsert(input: UpsertSnapshotInput): Promise<RoomAnalysisSnapshot> {
    const row = await this.db.roomAnalysisSnapshot.upsert({
      where: { roomId: input.roomId },
      create: {
        roomId: input.roomId,
        postCount: input.postCount,
        latestPostId: input.latestPostId,
        summary: input.summary,
        status: input.status,
        error: input.error,
      },
      update:
        input.status === "failed"
          ? {
              status: input.status,
              error: input.error,
            }
          : {
              postCount: input.postCount,
              latestPostId: input.latestPostId,
              summary: input.summary,
              status: input.status,
              error: input.error,
            },
    });
    return toSnapshot(row);
  }
}
