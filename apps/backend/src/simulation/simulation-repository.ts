import type { RoomVisibility, SimulationScope, SimulationStatus } from "@brickr/shared";
import type { Db, DbTransaction } from "../persistence/prisma.js";
import { optionalField } from "../persistence/repository-mapping.js";
import { toFallbackHandle } from "../user-profile/user-profile-repository.js";
import type { Simulation, SimulationActor, SimulationSummary } from "./simulation.js";

type SimulationRow = {
  id: string;
  title: string | null;
  status: string;
  scope: string;
  visibility: string;
  createdAt: Date;
  lastActivityAt: Date;
  createdByUserId: string | null;
};

/** The database column is an unconstrained string; this is the one place that trusts it. */
export function toSimulationStatus(value: string): SimulationStatus {
  return value as SimulationStatus;
}

/** The database column is an unconstrained string; this is the one place that trusts it. */
export function toSimulationScope(value: string): SimulationScope {
  return value as SimulationScope;
}

/** The database column is an unconstrained string; this is the one place that trusts it. */
export function toSimulationVisibility(value: string): RoomVisibility {
  return value as RoomVisibility;
}

function toSimulation(row: SimulationRow): Simulation {
  return {
    id: row.id,
    title: row.title,
    status: toSimulationStatus(row.status),
    scope: toSimulationScope(row.scope),
    visibility: toSimulationVisibility(row.visibility),
    createdAt: row.createdAt,
    lastActivityAt: row.lastActivityAt,
    ...optionalField("createdByUserId", row.createdByUserId),
  };
}

type SimulationSummaryRow = SimulationRow & {
  _count: { posts: number };
  createdByUser: { id: string; handle: string | null; displayName: string } | null;
};

// ---------------------------------------------------------------------------
// Internal note: the Prisma model is now `Room` (@@map("rooms")), but the
// domain layer still uses the name "Simulation" for the concept. All
// `this.db.simulation.*` calls below are replaced with `this.db.room.*`.
// ---------------------------------------------------------------------------

function toSimulationSummary(row: SimulationSummaryRow): SimulationSummary {
  return {
    ...toSimulation(row),
    postCount: row._count.posts,
    creator: row.createdByUser
      ? {
          id: row.createdByUser.id,
          handle: row.createdByUser.handle ?? toFallbackHandle(row.createdByUser.id),
          displayName: row.createdByUser.displayName,
        }
      : null,
  };
}

export class SimulationRepository {
  constructor(private readonly db: Db) {}

  /**
   * A room, always. The global row is seeded, never created here (§8.2).
   *
   * `lastActivityAt` starts at the creation time so an empty room still sorts
   * sensibly in an activity-ordered list.
   */
  async create(title: string | null, createdByUserId: string): Promise<Simulation> {
    const createdAt = new Date();
    const row = await this.db.room.create({
      data: {
        title,
        status: "active",
        scope: "room",
        visibility: "public",
        createdByUserId,
        createdAt,
        lastActivityAt: createdAt,
      },
    });
    return toSimulation(row);
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
  ): Promise<Simulation> {
    const createdAt = new Date();

    const simulation = await this.db.$transaction(async (tx: DbTransaction) => {
      const row = await tx.room.create({
        data: {
          title,
          status: "active",
          scope: "room",
          visibility,
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

    return toSimulation(simulation);
  }

  /**
   * Hard-deletes a room and all its posts (via cascade). Only callable on
   * archived rooms; the service layer enforces the status check and ownership
   * before calling this (issue #151).
   */
  async delete(id: string): Promise<void> {
    await this.db.room.delete({ where: { id } });
  }

  /**
   * Archives all active rooms owned by the given user. Called when an owner's
   * account is suspended so their rooms do not remain active without an owner
   * (issue #151).
   */
  async archiveOwnedBy(userId: string): Promise<void> {
    // Find rooms where this user is the creator and the room is still active.
    await this.db.room.updateMany({
      where: {
        createdByUserId: userId,
        status: "active",
        scope: "room",
      },
      data: { status: "archived" },
    });
  }

  /**
   * The rooms one actor may list, newest activity first (§10.3).
   *
   * Three rules, all enforced here rather than by filtering afterwards, so a
   * room the caller may not see is never even read:
   *
   * - The global row is excluded: it is the feed, not an entry in the room list
   *   (§8.2).
   * - A stopped room is listed only for its creator and for an administrator.
   *   Everyone else gets a list in which it does not appear at all, rather than
   *   an entry they cannot open (§10.3).
   * - Ordering is by `lastActivityAt`, not creation time, so an active room does
   *   not sink out of reach. An empty room keeps `lastActivityAt = createdAt`
   *   (§8.1), which makes it sort by creation time without a special case.
   */
  async findAllVisibleTo(actor: SimulationActor): Promise<SimulationSummary[]> {
    const rows = await this.db.room.findMany({
      where: {
        scope: "room",
        ...(actor.isAdmin
          ? {}
          : { OR: [{ status: "active" }, { createdByUserId: actor.id }] }),
      },
      include: {
        _count: { select: { posts: true } },
        createdByUser: { select: { id: true, handle: true, displayName: true } },
      },
      orderBy: [{ lastActivityAt: "desc" }, { id: "desc" }],
    });
    return rows.map(toSimulationSummary);
  }

  async findById(id: string): Promise<Simulation | null> {
    const row = await this.db.room.findUnique({ where: { id } });
    return row ? toSimulation(row) : null;
  }

  /**
   * One room, summary-shaped (§19.2): the room info panel needs `postCount`/
   * `creator` for a single room, the same fields `findAllVisibleTo` already
   * computes for the list.
   */
  async findSummaryById(id: string): Promise<SimulationSummary | null> {
    const row = await this.db.room.findUnique({
      where: { id },
      include: {
        _count: { select: { posts: true } },
        createdByUser: { select: { id: true, handle: true, displayName: true } },
      },
    });
    return row ? toSimulationSummary(row) : null;
  }

  async updateTitle(id: string, title: string): Promise<Simulation> {
    const row = await this.db.room.update({ where: { id }, data: { title } });
    return toSimulation(row);
  }

  async updateStatus(id: string, status: SimulationStatus): Promise<Simulation> {
    const row = await this.db.room.update({
      where: { id },
      data: { status },
    });
    return toSimulation(row);
  }
}
