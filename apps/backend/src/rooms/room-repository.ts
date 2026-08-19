import type { RoomVisibility, RoomStatus } from "@brickr/shared";
import type { Db, DbTransaction } from "../persistence/prisma.js";
import { optionalField } from "../persistence/repository-mapping.js";
import { toFallbackHandle } from "../user-profile/user-profile-repository.js";
import type { Room, SignedInActor, RoomSummary, RoomScope } from "./room.js";

type RoomRow = {
  id: string;
  title: string | null;
  status: string;
  visibility: string;
  scope: string;
  tags: string[];
  createdAt: Date;
  lastActivityAt: Date;
  createdByUserId: string | null;
};

/** The database column is an unconstrained string; this is the one place that trusts it. */
export function toRoomStatus(value: string): RoomStatus {
  return value as RoomStatus;
}

/** The database column is an unconstrained string; this is the one place that trusts it. */
export function toRoomVisibility(value: string): RoomVisibility {
  return value as RoomVisibility;
}

/** The database column is an unconstrained string; this is the one place that trusts it. */
export function toRoomScope(value: string): RoomScope {
  return value as RoomScope;
}

function toRoom(row: RoomRow): Room {
  return {
    id: row.id,
    title: row.title,
    status: toRoomStatus(row.status),
    visibility: toRoomVisibility(row.visibility),
    scope: toRoomScope(row.scope),
    tags: row.tags,
    createdAt: row.createdAt,
    lastActivityAt: row.lastActivityAt,
    ...optionalField("createdByUserId", row.createdByUserId),
  };
}

type RoomSummaryRow = RoomRow & {
  _count: { posts: number };
  createdByUser: { id: string; handle: string | null; displayName: string } | null;
  /** Pending membership count — only populated for the room list query. */
  _pendingCount?: number;
  /**
   * Whether the caller holds an active membership in this room.
   * Only populated for the room list query; used to apply metadata restrictions
   * for closed rooms.
   */
  _callerIsActiveMember?: boolean;
};

function toRoomSummary(row: RoomSummaryRow): RoomSummary {
  return {
    ...toRoom(row),
    postCount: row._count.posts,
    creator: row.createdByUser
      ? {
          id: row.createdByUser.id,
          handle: row.createdByUser.handle ?? toFallbackHandle(row.createdByUser.id),
          displayName: row.createdByUser.displayName,
        }
      : null,
    ...(row._pendingCount !== undefined ? { pendingCount: row._pendingCount } : {}),
    ...(row._callerIsActiveMember !== undefined
      ? { callerIsActiveMember: row._callerIsActiveMember }
      : {}),
  };
}

export class RoomRepository {
  constructor(private readonly db: Db) {}

  /**
   * Creates an ordinary room.
   *
   * `lastActivityAt` starts at the creation time so an empty room still sorts
   * sensibly in an activity-ordered list.
   */
  async create(title: string | null, createdByUserId: string): Promise<Room> {
    const createdAt = new Date();
    const row = await this.db.room.create({
      data: {
        title,
        status: "active",
        visibility: "public",
        scope: "room",
        createdByUserId,
        createdAt,
        lastActivityAt: createdAt,
      },
    });
    return toRoom(row);
  }

  /**
   * Creates a room and immediately grants the creator an active `owner` membership
   * in a single transaction (issue #151).
   *
   * Visibility is set at creation time and cannot be changed afterwards — the
   * service layer enforces this, but the repository records the chosen value here
   * so the column is populated from the start.
   */
  async createWithOwner(
    title: string | null,
    visibility: RoomVisibility,
    createdByUserId: string,
  ): Promise<Room> {
    const createdAt = new Date();

    const room = await this.db.$transaction(async (tx: DbTransaction) => {
      const row = await tx.room.create({
        data: {
          title,
          status: "active",
          visibility,
          scope: "room",
          createdByUserId,
          createdAt,
          lastActivityAt: createdAt,
        },
      });

      // Auto-create the owner's active membership in the same transaction so
      // the room never exists without an owner (§151).
      await tx.roomMembership.create({
        data: {
          roomId: row.id,
          memberKind: "user",
          memberId: createdByUserId,
          role: "owner",
          status: "active",
        },
      });

      return row;
    });

    return toRoom(room);
  }

  /**
   * Hard-deletes a room and all its posts (via cascade). Only callable on
   * archived rooms; the service layer enforces the status check and ownership
   * before calling this (issue #151).
   */
  async delete(id: string): Promise<void> {
    await this.db.room.delete({ where: { id } });
  }

  /** Archives active room-scoped rows selected from owner memberships (#151). */
  async archiveByIds(roomIds: string[]): Promise<void> {
    await this.db.room.updateMany({
      where: {
        id: { in: roomIds },
        status: "active",
      },
      data: { status: "archived" },
    });
  }

  /**
   * The rooms one actor may list, newest activity first (§10.3, issue #155).
   *
   * Visibility rules (enforced in the query, not by post-filtering):
   *
   * - A stopped room is listed only for its creator and for an administrator.
   *   Everyone else gets a list in which it does not appear at all (§10.3).
   * - `public` / `open` rooms are discoverable by all authenticated users.
   * - `closed` rooms appear in the list for all authenticated users, but the
   *   service layer restricts the metadata returned to non-members (issue #155).
   * - `private` rooms are visible to their creator, active members, and admins.
   * - Ordering is by `lastActivityAt`, not creation time, so an active room does
   *   not sink out of reach. An empty room keeps `lastActivityAt = createdAt`
   *   (§8.1), which makes it sort by creation time without a special case.
   *
   * Pending count: the number of pending join requests is included for each
   * room so the owner can show a badge. The service layer strips it from the
   * DTO for non-owners.
   *
   * Active membership snapshot: for each room, the caller's own active
   * membership (if any) is included so the service layer can apply metadata
   * restrictions without a second query.
   */
  async findAllVisibleTo(actor: SignedInActor): Promise<RoomSummary[]> {
    const rows = await this.db.room.findMany({
      where: {
        // The Feed room (scope: 'global') is never shown in the room list.
        scope: "room",
        ...(actor.isAdmin
          ? {}
          : {
              AND: [
                // Archived rooms: only the creator sees them.
                { OR: [{ status: "active" }, { createdByUserId: actor.id }] },
                // Visibility: public/open/closed are discoverable by all;
                // private requires ownership or an active membership. Ownership
                // is checked explicitly so legacy rooms whose owner membership
                // is absent remain consistent with the single-room read path.
                {
                  OR: [
                    { visibility: { in: ["public", "open", "closed"] } },
                    {
                      visibility: "private",
                      OR: [
                        { createdByUserId: actor.id },
                        {
                          memberships: {
                            some: {
                              memberId: actor.id,
                              memberKind: "user",
                              status: "active",
                            },
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            }),
      },
      include: {
        _count: {
          select: {
            posts: true,
            memberships: { where: { status: "pending" } },
          },
        },
        createdByUser: { select: { id: true, handle: true, displayName: true } },
        // Load the caller's own membership so the service can apply metadata
        // restrictions for closed rooms without a second query.
        memberships: {
          where: { memberId: actor.id, memberKind: "user" },
          select: { status: true },
          take: 1,
        },
      },
      orderBy: [{ lastActivityAt: "desc" }, { id: "desc" }],
    });

    return rows.map((row) => {
      const counts = row._count as { posts: number; memberships: number };
      const callerMembership = (row.memberships as Array<{ status: string }>)[0];
      const isActiveMember = callerMembership?.status === "active";
      return toRoomSummary({
        ...row,
        _count: { posts: counts.posts },
        _pendingCount: counts.memberships,
        _callerIsActiveMember: isActiveMember,
      });
    });
  }

  async findById(id: string): Promise<Room | null> {
    const row = await this.db.room.findUnique({ where: { id } });
    return row ? toRoom(row) : null;
  }

  /**
   * One room, summary-shaped (§19.2): the room info panel needs `postCount`/
   * `creator` for a single room, the same fields `findAllVisibleTo` already
   * computes for the list.
   */
  async findSummaryById(id: string): Promise<RoomSummary | null> {
    const row = await this.db.room.findUnique({
      where: { id },
      include: {
        _count: { select: { posts: true } },
        createdByUser: { select: { id: true, handle: true, displayName: true } },
      },
    });
    return row ? toRoomSummary(row) : null;
  }

  async updateTitle(id: string, title: string): Promise<Room> {
    const row = await this.db.room.update({ where: { id }, data: { title } });
    return toRoom(row);
  }

  async updateStatus(id: string, status: RoomStatus): Promise<Room> {
    const row = await this.db.room.update({
      where: { id },
      data: { status },
    });
    return toRoom(row);
  }
}
