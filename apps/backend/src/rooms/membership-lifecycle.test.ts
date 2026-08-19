/**
 * Membership lifecycle state-transition tests (issue #179).
 *
 * This file focuses on the allowed and forbidden state transitions for
 * RoomMembership, as specified in the Prisma schema and enforced by the
 * service layer. It complements `room-membership-service.test.ts` (which
 * tests the full service API) by providing a dedicated, readable table of
 * every transition rule.
 *
 * Allowed transitions (from schema.prisma):
 *   (none)   → pending(request)    self-initiated join request
 *   (none)   → pending(invitation) owner-initiated invitation
 *   pending  → active              owner approves request / invitee accepts
 *   pending  → (deleted)           owner rejects / invitee declines / withdrawn
 *   active   → left                self-initiated leave
 *   active   → removed             owner removes member
 *   active   → banned              owner bans member
 *   left     → active              re-join (public) or re-request (open)
 *   removed  → active              re-invite
 *   banned   → removed             owner unbans (cannot go directly to active)
 *
 * Forbidden transitions (all others):
 *   banned   → active              (must unban first: banned → removed → active)
 *   banned   → banned              (already banned)
 *   left     → banned              (cannot ban someone who already left)
 *   left     → removed             (cannot remove someone who already left)
 *   removed  → removed             (already removed)
 *   active   → active              (already active)
 */

import { describe, expect, it, vi } from "vitest";
import type { RoomRepository } from "./room-repository.js";
import type { RoomMembershipRepository, RoomMembership } from "./room-membership-repository.js";
import {
  RoomMembershipService,
  MemberAlreadyExistsError,
  MemberBannedError,
  InvalidStatusTransitionError,
} from "./room-membership-service.js";
import { RoomArchivedError } from "./room-service.js";
import type { Room, SignedInActor } from "./room.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER: SignedInActor = { id: "user-owner", isAdmin: false };
const ADMIN: SignedInActor = { id: "user-admin", isAdmin: true };
const MEMBER_ID = "user-target";

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: "room-1",
    title: "テストルーム",
    status: "active",
    visibility: "public",
    scope: "room",
    tags: [],
    createdAt: new Date("2026-08-16T00:00:00.000Z"),
    lastActivityAt: new Date("2026-08-16T00:00:00.000Z"),
    createdByUserId: OWNER.id,
    ...overrides,
  };
}

function makeMembership(overrides: Partial<RoomMembership> = {}): RoomMembership {
  return {
    id: "mem-1",
    roomId: "room-1",
    memberKind: "user",
    memberId: MEMBER_ID,
    role: "member",
    status: "active",
    createdAt: new Date("2026-08-16T00:00:00.000Z"),
    updatedAt: new Date("2026-08-16T00:00:00.000Z"),
    ...overrides,
  };
}

function makeRoomRepo(
  overrides: Partial<RoomRepository> = {},
): RoomRepository {
  return {
    create: vi.fn(),
    createWithOwner: vi.fn(),
    findById: vi.fn(() => Promise.resolve(makeRoom())),
    findSummaryById: vi.fn(),
    findAllVisibleTo: vi.fn(),
    updateTitle: vi.fn(),
    updateStatus: vi.fn(),
    delete: vi.fn(),
    archiveByIds: vi.fn(),
    ...overrides,
  } as unknown as RoomRepository;
}

function makeMembershipRepo(
  overrides: Partial<RoomMembershipRepository> = {},
): RoomMembershipRepository {
  const findByRoom = overrides.findByRoom ?? vi.fn(() => Promise.resolve([]));
  return {
    create: vi.fn((input) =>
      Promise.resolve(
        makeMembership({
          memberKind: input.memberKind,
          memberId: input.memberId,
          role: input.role,
          status: input.status,
          origin: input.origin,
          invitedById: input.invitedById,
        }),
      ),
    ),
    findByRoom,
    findByMember: vi.fn(() => Promise.resolve([])),
    findOne: vi.fn(() => Promise.resolve(null)),
    findById: vi.fn(async (id) => (await findByRoom("room-1")).find((m) => m.id === id) ?? null),
    findActiveOwnerRooms: vi.fn(() => Promise.resolve([])),
    findActiveCastIds: vi.fn(() => Promise.resolve([])),
    updateStatus: vi.fn((id, status) =>
      Promise.resolve(makeMembership({ id, status })),
    ),
    updateStatusByMember: vi.fn((_roomId, _kind, _memberId, status) =>
      Promise.resolve(makeMembership({ status })),
    ),
    reinviteByMember: vi.fn((_roomId, _kind, _memberId, invitedById, status = "active", origin) =>
      Promise.resolve(makeMembership({ status, origin, invitedById, invitedAt: new Date() })),
    ),
    deleteById: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  } as unknown as RoomMembershipRepository;
}

function makeService(
  simRepo?: Partial<RoomRepository>,
  memRepo?: Partial<RoomMembershipRepository>,
): RoomMembershipService {
  return new RoomMembershipService({
    rooms: makeRoomRepo(simRepo),
    memberships: makeMembershipRepo(memRepo),
  });
}

// ---------------------------------------------------------------------------
// Allowed transitions
// ---------------------------------------------------------------------------

describe("Membership lifecycle — allowed transitions", () => {
  // (none) → pending(request): handled by RoomService.join for open rooms.
  // (none) → pending(invitation): handled by invite for closed/private rooms.

  describe("(none) → pending(invitation): owner invites to closed room", () => {
    it("creates a pending(invitation) membership when no existing row", async () => {
      const service = makeService(
        { findById: vi.fn(() => Promise.resolve(makeRoom({ visibility: "closed" }))) },
        { findOne: vi.fn(() => Promise.resolve(null)) },
      );

      const result = await service.invite(
        { roomId: "room-1", targetId: MEMBER_ID, targetKind: "user", inviterId: OWNER.id },
        OWNER,
      );

      expect(result.status).toBe("pending");
      expect(result.origin).toBe("invitation");
    });
  });

  describe("(none) → active: owner invites to public room", () => {
    it("creates an active membership directly for a public room invitation", async () => {
      const service = makeService(
        { findById: vi.fn(() => Promise.resolve(makeRoom({ visibility: "public" }))) },
        { findOne: vi.fn(() => Promise.resolve(null)) },
      );

      const result = await service.invite(
        { roomId: "room-1", targetId: MEMBER_ID, targetKind: "user", inviterId: OWNER.id },
        OWNER,
      );

      expect(result.status).toBe("active");
    });
  });

  describe("pending → active: owner approves a pending membership", () => {
    it("transitions pending to active via approve", async () => {
      const service = makeService(undefined, {
        findByRoom: vi.fn(() =>
          Promise.resolve([makeMembership({ id: "mem-1", status: "pending" })]),
        ),
      });

      const result = await service.approve("room-1", "mem-1", OWNER);

      expect(result.status).toBe("active");
    });
  });

  describe("pending → (deleted): owner rejects a pending membership", () => {
    it("deletes the pending membership row via reject", async () => {
      const memberships = makeMembershipRepo({
        findByRoom: vi.fn(() =>
          Promise.resolve([makeMembership({ id: "mem-1", status: "pending" })]),
        ),
      });
      const service = new RoomMembershipService({
        rooms: makeRoomRepo(),
        memberships,
      });

      await service.reject("room-1", "mem-1", OWNER);

      expect(memberships.deleteById).toHaveBeenCalledWith("mem-1");
    });
  });

  describe("active → removed: owner removes an active member", () => {
    it("transitions active to removed via remove", async () => {
      const service = makeService(undefined, {
        findByRoom: vi.fn(() =>
          Promise.resolve([makeMembership({ id: "mem-1", status: "active" })]),
        ),
      });

      const result = await service.remove("room-1", "mem-1", OWNER);

      expect(result.status).toBe("removed");
    });
  });

  describe("active → banned: owner bans an active member", () => {
    it("transitions active to banned via ban", async () => {
      const service = makeService(undefined, {
        findByRoom: vi.fn(() =>
          Promise.resolve([makeMembership({ id: "mem-1", status: "active" })]),
        ),
      });

      const result = await service.ban("room-1", "mem-1", OWNER);

      expect(result.status).toBe("banned");
    });
  });

  describe("removed → active: owner re-invites a removed member", () => {
    it("re-invites a removed member to active via reinviteByMember", async () => {
      const service = makeService(undefined, {
        findOne: vi.fn(() => Promise.resolve(makeMembership({ status: "removed" }))),
      });

      const result = await service.invite(
        { roomId: "room-1", targetId: MEMBER_ID, targetKind: "user", inviterId: OWNER.id },
        OWNER,
      );

      expect(result.status).toBe("active");
    });
  });

  describe("left → active: owner re-invites a member who left", () => {
    it("re-invites a left member to active via reinviteByMember", async () => {
      const service = makeService(undefined, {
        findOne: vi.fn(() => Promise.resolve(makeMembership({ status: "left" }))),
      });

      const result = await service.invite(
        { roomId: "room-1", targetId: MEMBER_ID, targetKind: "user", inviterId: OWNER.id },
        OWNER,
      );

      expect(result.status).toBe("active");
    });
  });

  describe("banned → removed: owner unbans a banned member", () => {
    it("transitions banned to removed via unban", async () => {
      const service = makeService(undefined, {
        findByRoom: vi.fn(() =>
          Promise.resolve([makeMembership({ id: "mem-1", status: "banned" })]),
        ),
      });

      const result = await service.unban("room-1", "mem-1", OWNER);

      expect(result.status).toBe("removed");
    });
  });

  describe("pending → removed: owner removes a pending member", () => {
    it("transitions pending to removed via remove", async () => {
      const service = makeService(undefined, {
        findByRoom: vi.fn(() =>
          Promise.resolve([makeMembership({ id: "mem-1", status: "pending" })]),
        ),
      });

      const result = await service.remove("room-1", "mem-1", OWNER);

      expect(result.status).toBe("removed");
    });
  });

  describe("pending → banned: owner bans a pending member", () => {
    it("transitions pending to banned via ban", async () => {
      const service = makeService(undefined, {
        findByRoom: vi.fn(() =>
          Promise.resolve([makeMembership({ id: "mem-1", status: "pending" })]),
        ),
      });

      const result = await service.ban("room-1", "mem-1", OWNER);

      expect(result.status).toBe("banned");
    });
  });

  describe("removed → banned: owner bans a removed member", () => {
    it("transitions removed to banned via ban", async () => {
      const service = makeService(undefined, {
        findByRoom: vi.fn(() =>
          Promise.resolve([makeMembership({ id: "mem-1", status: "removed" })]),
        ),
      });

      const result = await service.ban("room-1", "mem-1", OWNER);

      expect(result.status).toBe("banned");
    });
  });
});

// ---------------------------------------------------------------------------
// Forbidden transitions
// ---------------------------------------------------------------------------

describe("Membership lifecycle — forbidden transitions", () => {
  describe("banned → active (direct): must go through unban first", () => {
    it("throws MemberBannedError when trying to re-invite a banned member", async () => {
      const service = makeService(undefined, {
        findOne: vi.fn(() => Promise.resolve(makeMembership({ status: "banned" }))),
      });

      await expect(
        service.invite(
          { roomId: "room-1", targetId: MEMBER_ID, targetKind: "user", inviterId: OWNER.id },
          OWNER,
        ),
      ).rejects.toThrow(MemberBannedError);
    });
  });

  describe("banned → banned: already banned", () => {
    it("throws InvalidStatusTransitionError when banning an already-banned member", async () => {
      const service = makeService(undefined, {
        findByRoom: vi.fn(() =>
          Promise.resolve([makeMembership({ id: "mem-1", status: "banned" })]),
        ),
      });

      await expect(service.ban("room-1", "mem-1", OWNER)).rejects.toThrow(
        InvalidStatusTransitionError,
      );
    });
  });

  describe("left → banned: cannot ban someone who already left", () => {
    it("throws InvalidStatusTransitionError when banning a left member", async () => {
      const service = makeService(undefined, {
        findByRoom: vi.fn(() =>
          Promise.resolve([makeMembership({ id: "mem-1", status: "left" })]),
        ),
      });

      await expect(service.ban("room-1", "mem-1", OWNER)).rejects.toThrow(
        InvalidStatusTransitionError,
      );
    });
  });

  describe("left → removed: cannot remove someone who already left", () => {
    it("throws InvalidStatusTransitionError when removing a left member", async () => {
      const service = makeService(undefined, {
        findByRoom: vi.fn(() =>
          Promise.resolve([makeMembership({ id: "mem-1", status: "left" })]),
        ),
      });

      await expect(service.remove("room-1", "mem-1", OWNER)).rejects.toThrow(
        InvalidStatusTransitionError,
      );
    });
  });

  describe("removed → removed: already removed", () => {
    it("throws InvalidStatusTransitionError when removing an already-removed member", async () => {
      const service = makeService(undefined, {
        findByRoom: vi.fn(() =>
          Promise.resolve([makeMembership({ id: "mem-1", status: "removed" })]),
        ),
      });

      await expect(service.remove("room-1", "mem-1", OWNER)).rejects.toThrow(
        InvalidStatusTransitionError,
      );
    });
  });

  describe("banned → removed via remove: must use unban, not remove", () => {
    it("throws InvalidStatusTransitionError when trying to remove a banned member", async () => {
      const service = makeService(undefined, {
        findByRoom: vi.fn(() =>
          Promise.resolve([makeMembership({ id: "mem-1", status: "banned" })]),
        ),
      });

      await expect(service.remove("room-1", "mem-1", OWNER)).rejects.toThrow(
        InvalidStatusTransitionError,
      );
    });
  });

  describe("active → active: already active", () => {
    it("throws MemberAlreadyExistsError when inviting an already-active member", async () => {
      const service = makeService(undefined, {
        findOne: vi.fn(() => Promise.resolve(makeMembership({ status: "active" }))),
      });

      await expect(
        service.invite(
          { roomId: "room-1", targetId: MEMBER_ID, targetKind: "user", inviterId: OWNER.id },
          OWNER,
        ),
      ).rejects.toThrow(MemberAlreadyExistsError);
    });
  });

  describe("pending → active via non-pending approve: must be pending", () => {
    it("throws InvalidStatusTransitionError when approving an already-active membership", async () => {
      const service = makeService(undefined, {
        findByRoom: vi.fn(() =>
          Promise.resolve([makeMembership({ id: "mem-1", status: "active" })]),
        ),
      });

      await expect(service.approve("room-1", "mem-1", OWNER)).rejects.toThrow(
        InvalidStatusTransitionError,
      );
    });
  });

  describe("non-pending → deleted via reject: must be pending", () => {
    it("throws InvalidStatusTransitionError when rejecting an active membership", async () => {
      const service = makeService(undefined, {
        findByRoom: vi.fn(() =>
          Promise.resolve([makeMembership({ id: "mem-1", status: "active" })]),
        ),
      });

      await expect(service.reject("room-1", "mem-1", OWNER)).rejects.toThrow(
        InvalidStatusTransitionError,
      );
    });
  });

  describe("non-banned → removed via unban: must be banned", () => {
    it("throws InvalidStatusTransitionError when unbanning an active member", async () => {
      const service = makeService(undefined, {
        findByRoom: vi.fn(() =>
          Promise.resolve([makeMembership({ id: "mem-1", status: "active" })]),
        ),
      });

      await expect(service.unban("room-1", "mem-1", OWNER)).rejects.toThrow(
        InvalidStatusTransitionError,
      );
    });

    it("throws InvalidStatusTransitionError when unbanning a removed member", async () => {
      const service = makeService(undefined, {
        findByRoom: vi.fn(() =>
          Promise.resolve([makeMembership({ id: "mem-1", status: "removed" })]),
        ),
      });

      await expect(service.unban("room-1", "mem-1", OWNER)).rejects.toThrow(
        InvalidStatusTransitionError,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Owner protection
// ---------------------------------------------------------------------------

describe("Membership lifecycle — owner membership is immutable", () => {
  it("cannot remove the owner's membership", async () => {
    const service = makeService(undefined, {
      findByRoom: vi.fn(() =>
        Promise.resolve([makeMembership({ id: "mem-1", role: "owner", status: "active" })]),
      ),
    });

    const { CannotModifyOwnerError } = await import("./room-membership-service.js");
    await expect(service.remove("room-1", "mem-1", OWNER)).rejects.toThrow(
      CannotModifyOwnerError,
    );
  });

  it("cannot ban the owner's membership", async () => {
    const service = makeService(undefined, {
      findByRoom: vi.fn(() =>
        Promise.resolve([makeMembership({ id: "mem-1", role: "owner", status: "active" })]),
      ),
    });

    const { CannotModifyOwnerError } = await import("./room-membership-service.js");
    await expect(service.ban("room-1", "mem-1", OWNER)).rejects.toThrow(CannotModifyOwnerError);
  });
});

// ---------------------------------------------------------------------------
// Archived room: all mutations are blocked
// ---------------------------------------------------------------------------

describe("Membership lifecycle — archived rooms block all mutations", () => {
  const archivedRoom = makeRoom({ status: "archived" });

  it("invite is blocked on an archived room", async () => {
    const service = makeService({
      findById: vi.fn(() => Promise.resolve(archivedRoom)),
    });

    await expect(
      service.invite(
        { roomId: "room-1", targetId: MEMBER_ID, targetKind: "user", inviterId: OWNER.id },
        OWNER,
      ),
    ).rejects.toThrow(RoomArchivedError);
  });

  it("remove is blocked on an archived room", async () => {
    const service = makeService({
      findById: vi.fn(() => Promise.resolve(archivedRoom)),
    });

    await expect(service.remove("room-1", "mem-1", OWNER)).rejects.toThrow(RoomArchivedError);
  });

  it("ban is blocked on an archived room", async () => {
    const service = makeService({
      findById: vi.fn(() => Promise.resolve(archivedRoom)),
    });

    await expect(service.ban("room-1", "mem-1", OWNER)).rejects.toThrow(RoomArchivedError);
  });

  it("approve is blocked on an archived room", async () => {
    const service = makeService({
      findById: vi.fn(() => Promise.resolve(archivedRoom)),
    });

    await expect(service.approve("room-1", "mem-1", OWNER)).rejects.toThrow(RoomArchivedError);
  });

  it("reject is not blocked on an archived room (no archived check in reject)", async () => {
    // reject does not check for archived status — it only checks pending status.
    // This is intentional: an owner can still clean up pending requests on an archived room.
    const service = makeService(
      { findById: vi.fn(() => Promise.resolve(archivedRoom)) },
      {
        findByRoom: vi.fn(() =>
          Promise.resolve([makeMembership({ id: "mem-1", status: "pending" })]),
        ),
      },
    );

    // Should not throw RoomArchivedError — reject has no archived check.
    await expect(service.reject("room-1", "mem-1", OWNER)).resolves.toBeUndefined();
  });

  it("unban is not blocked on an archived room (no archived check in unban)", async () => {
    // unban does not check for archived status — a ban set before archiving can still be lifted.
    const service = makeService(
      { findById: vi.fn(() => Promise.resolve(archivedRoom)) },
      {
        findByRoom: vi.fn(() =>
          Promise.resolve([makeMembership({ id: "mem-1", status: "banned" })]),
        ),
      },
    );

    const result = await service.unban("room-1", "mem-1", OWNER);
    expect(result.status).toBe("removed");
  });
});

// ---------------------------------------------------------------------------
// Admin can perform all transitions
// ---------------------------------------------------------------------------

describe("Membership lifecycle — admin can perform all transitions", () => {
  it("admin can approve a pending membership", async () => {
    const service = makeService(undefined, {
      findByRoom: vi.fn(() =>
        Promise.resolve([makeMembership({ id: "mem-1", status: "pending" })]),
      ),
    });

    const result = await service.approve("room-1", "mem-1", ADMIN);
    expect(result.status).toBe("active");
  });

  it("admin can ban an active member", async () => {
    const service = makeService(undefined, {
      findByRoom: vi.fn(() =>
        Promise.resolve([makeMembership({ id: "mem-1", status: "active" })]),
      ),
    });

    const result = await service.ban("room-1", "mem-1", ADMIN);
    expect(result.status).toBe("banned");
  });

  it("admin can unban a banned member", async () => {
    const service = makeService(undefined, {
      findByRoom: vi.fn(() =>
        Promise.resolve([makeMembership({ id: "mem-1", status: "banned" })]),
      ),
    });

    const result = await service.unban("room-1", "mem-1", ADMIN);
    expect(result.status).toBe("removed");
  });
});

// ---------------------------------------------------------------------------
// Concurrent request handling
// ---------------------------------------------------------------------------

describe("Membership lifecycle — concurrent request handling", () => {
  it("throws MemberAlreadyExistsError when a pending invitation already exists", async () => {
    // Simulates a race condition where two invitations are sent simultaneously.
    const service = makeService(undefined, {
      findOne: vi.fn(() => Promise.resolve(makeMembership({ status: "pending" }))),
    });

    await expect(
      service.invite(
        { roomId: "room-1", targetId: MEMBER_ID, targetKind: "user", inviterId: OWNER.id },
        OWNER,
      ),
    ).rejects.toThrow(MemberAlreadyExistsError);
  });

  it("maps a unique constraint violation to MemberAlreadyExistsError", async () => {
    // Simulates a race condition at the DB level (two concurrent inserts).
    const service = makeService(undefined, {
      findOne: vi.fn(() => Promise.resolve(null)),
      create: vi.fn().mockRejectedValue(
        Object.assign(new Error("unique constraint"), { code: "P2002" }),
      ),
    });

    await expect(
      service.invite(
        { roomId: "room-1", targetId: MEMBER_ID, targetKind: "user", inviterId: OWNER.id },
        OWNER,
      ),
    ).rejects.toThrow(MemberAlreadyExistsError);
  });
});
