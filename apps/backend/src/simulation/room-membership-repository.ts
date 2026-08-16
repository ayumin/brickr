import type { MemberKind, MemberRole, MembershipStatus } from "@brickr/shared";
import type { Db, DbTransaction } from "../persistence/prisma.js";
import { optionalField } from "../persistence/repository-mapping.js";

export type RoomMembership = {
  id: string;
  roomId: string;
  memberKind: MemberKind;
  memberId: string;
  role: MemberRole;
  status: MembershipStatus;
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
}
