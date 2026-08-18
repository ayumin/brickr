import { describe, expect, it, vi } from "vitest";
import type { Db } from "../persistence/prisma.js";
import { RoomMembershipRepository } from "./room-membership-repository.js";

const membershipRow = {
  id: "membership-1",
  roomId: "room-1",
  memberKind: "user",
  memberId: "user-1",
  role: "member",
  status: "active",
  invitedById: null,
  invitedAt: null,
  createdAt: new Date("2026-08-16T00:00:00.000Z"),
  updatedAt: new Date("2026-08-16T00:00:00.000Z"),
};

describe("RoomMembershipRepository.findById", () => {
  it("queries a single membership by primary key", async () => {
    const findUnique = vi.fn().mockResolvedValue(membershipRow);
    const db = { roomMembership: { findUnique } } as unknown as Db;

    await expect(new RoomMembershipRepository(db).findById("membership-1")).resolves.toMatchObject({
      id: "membership-1",
      roomId: "room-1",
    });
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "membership-1" } });
  });
});

describe("RoomMembershipRepository.reinviteByMember", () => {
  it("reactivates the membership, clears its origin, and refreshes invitation audit fields", async () => {
    const update = vi.fn().mockResolvedValue({
      ...membershipRow,
      invitedById: "owner-2",
      invitedAt: new Date(),
    });
    const db = { roomMembership: { update } } as unknown as Db;

    await new RoomMembershipRepository(db).reinviteByMember(
      "room-1",
      "user",
      "user-1",
      "owner-2",
    );

    expect(update).toHaveBeenCalledWith({
      where: {
        roomId_memberKind_memberId: {
          roomId: "room-1",
          memberKind: "user",
          memberId: "user-1",
        },
      },
      data: {
        status: "active",
        origin: null,
        invitedById: "owner-2",
        invitedAt: expect.any(Date),
      },
    });
  });

  it("restores a closed-room user as a pending invitation", async () => {
    const update = vi.fn().mockResolvedValue({
      ...membershipRow,
      status: "pending",
      origin: "invitation",
      invitedById: "owner-2",
      invitedAt: new Date(),
    });
    const db = { roomMembership: { update } } as unknown as Db;

    await new RoomMembershipRepository(db).reinviteByMember(
      "room-1",
      "user",
      "user-1",
      "owner-2",
      "pending",
      "invitation",
    );

    expect(update).toHaveBeenCalledWith({
      where: {
        roomId_memberKind_memberId: {
          roomId: "room-1",
          memberKind: "user",
          memberId: "user-1",
        },
      },
      data: {
        status: "pending",
        origin: "invitation",
        invitedById: "owner-2",
        invitedAt: expect.any(Date),
      },
    });
  });
});

describe("RoomMembershipRepository.updateStatusByMember", () => {
  it("records the origin when transitioning into pending", async () => {
    const update = vi.fn().mockResolvedValue({
      ...membershipRow,
      status: "pending",
      origin: "request",
    });
    const db = { roomMembership: { update } } as unknown as Db;

    await new RoomMembershipRepository(db).updateStatusByMember(
      "room-1",
      "user",
      "user-1",
      "pending",
      "request",
    );

    expect(update).toHaveBeenCalledWith({
      where: {
        roomId_memberKind_memberId: {
          roomId: "room-1",
          memberKind: "user",
          memberId: "user-1",
        },
      },
      data: { status: "pending", origin: "request" },
    });
  });
});

describe("RoomMembershipRepository.updateStatus", () => {
  it("returns null when Prisma reports that the membership does not exist", async () => {
    const update = vi.fn().mockRejectedValue(
      Object.assign(new Error("Record not found"), { code: "P2025" }),
    );
    const db = { roomMembership: { update } } as unknown as Db;

    await expect(
      new RoomMembershipRepository(db).updateStatus("membership-1", "active"),
    ).resolves.toBeNull();
  });

  it("rethrows database failures other than a missing record", async () => {
    const databaseError = new Error("database unavailable");
    const update = vi.fn().mockRejectedValue(databaseError);
    const db = { roomMembership: { update } } as unknown as Db;

    await expect(
      new RoomMembershipRepository(db).updateStatus("membership-1", "active"),
    ).rejects.toBe(databaseError);
  });
});

describe("RoomMembershipRepository.findPendingCastIds", () => {
  it("queries pending character memberships and returns their character IDs", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { memberId: "char-1" },
      { memberId: "char-2" },
    ]);
    const db = { roomMembership: { findMany } } as unknown as Db;

    await expect(
      new RoomMembershipRepository(db).findPendingCastIds("room-1"),
    ).resolves.toEqual(["char-1", "char-2"]);
    expect(findMany).toHaveBeenCalledWith({
      where: { roomId: "room-1", memberKind: "character", status: "pending" },
      select: { memberId: true },
    });
  });
});
