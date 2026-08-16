import { describe, expect, it, vi } from "vitest";
import type { Db } from "../persistence/prisma.js";
import { RoomMembershipRepository } from "./room-membership-repository.js";

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
