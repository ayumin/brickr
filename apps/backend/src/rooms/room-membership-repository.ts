import type { MemberKind, MemberRole, MembershipOrigin, MembershipStatus } from "@brickr/shared";
import {
  isRecordNotFoundError,
  type Db,
  type DbTransaction,
} from "../persistence/prisma.js";
import { optionalField } from "../persistence/repository-mapping.js";

export type RoomMembership = {
  id: string;
  roomId: string;
  memberKind: MemberKind;
  memberId: string;
  role: MemberRole;
  status: MembershipStatus;
  /** Present when status is pending: distinguishes a self-initiated request from an owner invitation. */
  origin?: MembershipOrigin;
  invitedById?: string;
  invitedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

type MembershipRow = {
  id: string;
  roomId: string;
  memberKind: string;
  memberId: string;
  role: string;
  status: string;
  origin: string | null;
  invitedById: string | null;
  invitedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toMembership(row: MembershipRow): RoomMembership {
  return {
    id: row.id,
    roomId: row.roomId,
    memberKind: row.memberKind as MemberKind,
    memberId: row.memberId,
    role: row.role as MemberRole,
    status: row.status as MembershipStatus,
    ...(row.origin ? { origin: row.origin as MembershipOrigin } : {}),
    ...optionalField("invitedById", row.invitedById),
    ...(row.invitedAt ? { invitedAt: row.invitedAt } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type CreateMembershipInput = {
  roomId: string;
  memberKind: MemberKind;
  memberId: string;
  role: MemberRole;
  status: MembershipStatus;
  /** Required when status is pending: identifies whether this is a self-request or an owner invitation. */
  origin?: MembershipOrigin;
  invitedById?: string;
};

export class RoomMembershipRepository {
  constructor(private readonly db: Db) {}

  /**
   * Creates a membership record. Accepts an optional transaction client so the
   * caller can include this write in a larger atomic operation (e.g. room creation).
   */
  async create(
    input: CreateMembershipInput,
    tx?: DbTransaction,
  ): Promise<RoomMembership> {
    const client = tx ?? this.db;
    const row = await client.roomMembership.create({
      data: {
        roomId: input.roomId,
        memberKind: input.memberKind,
        memberId: input.memberId,
        role: input.role,
        status: input.status,
        ...(input.origin ? { origin: input.origin } : {}),
        ...(input.invitedById ? { invitedById: input.invitedById } : {}),
      },
    });
    return toMembership(row);
  }

  /** All memberships for a room, optionally filtered by status. */
  async findByRoom(
    roomId: string,
    status?: MembershipStatus,
  ): Promise<RoomMembership[]> {
    const rows = await this.db.roomMembership.findMany({
      where: { roomId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toMembership);
  }

  /** All memberships for a given member (user or character), optionally filtered by status. */
  async findByMember(
    memberId: string,
    memberKind: MemberKind,
    status?: MembershipStatus,
  ): Promise<RoomMembership[]> {
    const rows = await this.db.roomMembership.findMany({
      where: { memberId, memberKind, ...(status ? { status } : {}) },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toMembership);
  }

  /** The single membership for a (room, memberKind, memberId) triple, or null. */
  async findOne(
    roomId: string,
    memberKind: MemberKind,
    memberId: string,
  ): Promise<RoomMembership | null> {
    const row = await this.db.roomMembership.findUnique({
      where: { roomId_memberKind_memberId: { roomId, memberKind, memberId } },
    });
    return row ? toMembership(row) : null;
  }

  /** A membership identified by its primary key, or null. */
  async findById(id: string): Promise<RoomMembership | null> {
    const row = await this.db.roomMembership.findUnique({ where: { id } });
    return row ? toMembership(row) : null;
  }

  /**
   * Finds all rooms where the given user holds the `owner` role with `active` status.
   * Used to archive rooms when an owner's account is suspended.
   */
  async findActiveOwnerRooms(userId: string): Promise<string[]> {
    const rows = await this.db.roomMembership.findMany({
      where: {
        memberId: userId,
        memberKind: "user",
        role: "owner",
        status: "active",
      },
      select: { roomId: true },
    });
    return rows.map((row: { roomId: string }) => row.roomId);
  }

  /**
   * Updates the status of a single membership record identified by its id.
   * Records a supplied origin when entering `pending`, and clears it when leaving `pending`.
   * Returns the updated membership, or null if no row matched.
   */
  async updateStatus(
    id: string,
    status: MembershipStatus,
  ): Promise<RoomMembership | null> {
    try {
      const row = await this.db.roomMembership.update({
        where: { id },
        // Clear origin when leaving pending state; it is only meaningful while pending.
        data: { status, ...(status !== "pending" ? { origin: null } : {}) },
      });
      return toMembership(row);
    } catch (error) {
      if (isRecordNotFoundError(error)) return null;
      throw error;
    }
  }

  /**
   * Updates the status of a membership identified by the (room, memberKind, memberId) triple.
   * Clears the `origin` field when transitioning away from `pending`.
   * Returns the updated membership, or null if no row matched.
   *
   * Used by the Cast join flow to transition a membership from `pending` to
   * `active` (approval) or to `removed`/`banned` (rejection).
   */
  async updateStatusByMember(
    roomId: string,
    memberKind: MemberKind,
    memberId: string,
    status: MembershipStatus,
    origin?: MembershipOrigin,
  ): Promise<RoomMembership | null> {
    try {
      const row = await this.db.roomMembership.update({
        where: { roomId_memberKind_memberId: { roomId, memberKind, memberId } },
        // Set the pending flow's origin when supplied, or clear it when leaving pending.
        data: {
          status,
          ...(status === "pending"
            ? (origin ? { origin } : {})
            : { origin: null }),
        },
      });
      return toMembership(row);
    } catch (error) {
      if (isRecordNotFoundError(error)) return null;
      throw error;
    }
  }

  /** Re-invites a previous membership and refreshes its invitation audit data. */
  async reinviteByMember(
    roomId: string,
    memberKind: MemberKind,
    memberId: string,
    invitedById: string,
    status: MembershipStatus = "active",
    origin?: MembershipOrigin,
  ): Promise<RoomMembership | null> {
    try {
      const row = await this.db.roomMembership.update({
        where: { roomId_memberKind_memberId: { roomId, memberKind, memberId } },
        data: {
          status,
          // Origin only has meaning while pending. Invitation callers supply it explicitly.
          origin: status === "pending" ? (origin ?? null) : null,
          invitedById,
          invitedAt: new Date(),
        },
      });
      return toMembership(row);
    } catch (error) {
      if (isRecordNotFoundError(error)) return null;
      throw error;
    }
  }

  /**
   * Deletes a membership record by its id.
   * Returns true if a row was deleted, false if no row matched.
   */
  async deleteById(id: string): Promise<boolean> {
    try {
      await this.db.roomMembership.delete({ where: { id } });
      return true;
    } catch (error) {
      if (isRecordNotFoundError(error)) return false;
      throw error;
    }
  }

  /**
   * Counts the number of pending Cast memberships in a room.
   *
   * Used to enforce the per-room pending Cast limit (issue #164: "同時に pending
   * 状態の Cast 数を制限").
   */
  async countPendingCasts(roomId: string): Promise<number> {
    return this.db.roomMembership.count({
      where: { roomId, memberKind: "character", status: "pending" },
    });
  }

  /**
   * Returns the IDs of all characters that are active members of a room.
   *
   * Used by the Cast recommendation scorer to exclude characters that are
   * already in the room from the candidate pool.
   */
  async findActiveCastIds(roomId: string): Promise<string[]> {
    const rows = await this.db.roomMembership.findMany({
      where: { roomId, memberKind: "character", status: "active" },
      select: { memberId: true },
    });
    return rows.map((row: { memberId: string }) => row.memberId);
  }

  /** Returns pending Cast IDs so repeated join-request events do not re-evaluate them. */
  async findPendingCastIds(roomId: string): Promise<string[]> {
    const rows = await this.db.roomMembership.findMany({
      where: { roomId, memberKind: "character", status: "pending" },
      select: { memberId: true },
    });
    return rows.map((row: { memberId: string }) => row.memberId);
  }

  /**
   * Returns the IDs of all characters that are banned from a room.
   *
   * Used by the Cast recommendation scorer to exclude banned characters from
   * the candidate pool.
   */
  async findBannedCastIds(roomId: string): Promise<string[]> {
    const rows = await this.db.roomMembership.findMany({
      where: { roomId, memberKind: "character", status: "banned" },
      select: { memberId: true },
    });
    return rows.map((row: { memberId: string }) => row.memberId);
  }

  /**
   * Returns the number of active rooms a character currently belongs to.
   *
   * Used by the Cast recommendation scorer to penalise characters that are
   * already spread across many rooms (overload prevention).
   */
  async countActiveRoomsForCast(characterId: string): Promise<number> {
    return this.db.roomMembership.count({
      where: { memberId: characterId, memberKind: "character", status: "active" },
    });
  }
}
