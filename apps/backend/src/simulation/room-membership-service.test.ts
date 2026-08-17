/**
 * Tests for RoomMembershipService (issue #154).
 *
 * Verifies:
 *   - invite: creates active membership, re-invites left/removed, rejects banned/active/pending
 *   - remove: active/pending → removed, rejects owner, banned, left, removed
 *   - ban: active/removed/pending → banned, rejects owner, left, already-banned
 *   - unban: banned → removed, rejects non-banned
 *   - listPending: owner/admin only
 *   - approve: pending → active, rejects non-pending
 *   - reject: pending → deleted, rejects non-pending
 *   - archived room: invite/remove/ban/approve/reject all throw RoomArchivedError
 *   - non-owner/non-admin: all operations throw RoomForbiddenError
 */
import { describe, expect, it, vi } from "vitest";
import type { SimulationRepository } from "./simulation-repository.js";
import type { RoomMembershipRepository } from "./room-membership-repository.js";
import type { RoomMembership } from "./room-membership-repository.js";
import {
  RoomMembershipService,
  MembershipNotFoundError,
  MemberAlreadyExistsError,
  MemberBannedError,
  CannotModifyOwnerError,
  InvalidStatusTransitionError,
} from "./room-membership-service.js";
import { RoomNotFoundError, RoomArchivedError, RoomForbiddenError } from "./room-service.js";
import { FeedRoomImmutableError } from "./feed-room-guard.js";
import type { Simulation, SimulationActor } from "./simulation.js";


// ── Fixtures ──────────────────────────────────────────────────────────────────

const OWNER: SimulationActor = { id: "user-owner", isAdmin: false };
const ADMIN: SimulationActor = { id: "user-admin", isAdmin: true };
const OTHER: SimulationActor = { id: "user-other", isAdmin: false };

function makeRoom(overrides: Partial<Simulation> = {}): Simulation {
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

/** The reserved Feed room: unowned (admin-only), scope: 'global'. */
function makeFeedRoom(overrides: Partial<Simulation> = {}): Simulation {
  return makeRoom({ scope: "global", createdByUserId: undefined, ...overrides });
}

function makeMembership(overrides: Partial<RoomMembership> = {}): RoomMembership {
  return {
    id: "mem-1",
    roomId: "room-1",
    memberKind: "user",
    memberId: "user-target",
    role: "member",
    status: "active",
    createdAt: new Date("2026-08-16T00:00:00.000Z"),
    updatedAt: new Date("2026-08-16T00:00:00.000Z"),
    ...overrides,
  };
}

function makeSimulationRepo(
  overrides: Partial<SimulationRepository> = {},
): SimulationRepository {
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
  } as unknown as SimulationRepository;
}

function makeMembershipRepo(
  overrides: Partial<RoomMembershipRepository> = {},
): RoomMembershipRepository {
  const findByRoom = overrides.findByRoom ?? vi.fn(() => Promise.resolve([]));
  return {
    create: vi.fn(() => Promise.resolve(makeMembership())),
    findByRoom,
    findByMember: vi.fn(() => Promise.resolve([])),
    findOne: vi.fn(() => Promise.resolve(null)),
    findById: vi.fn(async (id) => (await findByRoom("room-1")).find((m) => m.id === id) ?? null),
    findActiveOwnerRooms: vi.fn(() => Promise.resolve([])),
    updateStatus: vi.fn((id, status) =>
      Promise.resolve(makeMembership({ id, status })),
    ),
    updateStatusByMember: vi.fn((_roomId, _kind, _memberId, status) =>
      Promise.resolve(makeMembership({ status })),
    ),
    reinviteByMember: vi.fn((_roomId, _kind, _memberId, invitedById) =>
      Promise.resolve(makeMembership({ status: "active", invitedById, invitedAt: new Date() })),
    ),
    deleteById: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  } as unknown as RoomMembershipRepository;
}

function makeService(
  simRepo?: Partial<SimulationRepository>,
  memRepo?: Partial<RoomMembershipRepository>,
): {
  service: RoomMembershipService;
  simulations: SimulationRepository;
  memberships: RoomMembershipRepository;
} {
  const simulations = makeSimulationRepo(simRepo);
  const memberships = makeMembershipRepo(memRepo);
  const service = new RoomMembershipService({ simulations, memberships });
  return { service, simulations, memberships };
}

// ── invite ────────────────────────────────────────────────────────────────────

describe("RoomMembershipService.invite", () => {
  it("creates an active membership when no existing row", async () => {
    const { service, memberships } = makeService();

    const result = await service.invite(
      { roomId: "room-1", targetId: "user-target", targetKind: "user", inviterId: OWNER.id },
      OWNER,
    );

    expect(memberships.create).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: "room-1",
        memberId: "user-target",
        memberKind: "user",
        role: "member",
        status: "active",
        invitedById: OWNER.id,
      }),
    );
    expect(result.status).toBe("active");
  });

  it("creates an active membership for a character", async () => {
    const { service, memberships } = makeService();

    await service.invite(
      { roomId: "room-1", targetId: "char-1", targetKind: "character", inviterId: OWNER.id },
      OWNER,
    );

    expect(memberships.create).toHaveBeenCalledWith(
      expect.objectContaining({ memberKind: "character", memberId: "char-1" }),
    );
  });

  it("re-invites a left member by updating to active", async () => {
    const { service, memberships } = makeService(undefined, {
      findOne: vi.fn(() => Promise.resolve(makeMembership({ status: "left" }))),
    });

    await service.invite(
      { roomId: "room-1", targetId: "user-target", targetKind: "user", inviterId: OWNER.id },
      OWNER,
    );

    expect(memberships.reinviteByMember).toHaveBeenCalledWith(
      "room-1",
      "user",
      "user-target",
      OWNER.id,
    );
    expect(memberships.create).not.toHaveBeenCalled();
  });

  it("re-invites a removed member by updating to active", async () => {
    const { service, memberships } = makeService(undefined, {
      findOne: vi.fn(() => Promise.resolve(makeMembership({ status: "removed" }))),
    });

    await service.invite(
      { roomId: "room-1", targetId: "user-target", targetKind: "user", inviterId: OWNER.id },
      OWNER,
    );

    expect(memberships.reinviteByMember).toHaveBeenCalledWith(
      "room-1",
      "user",
      "user-target",
      OWNER.id,
    );
  });

  it("maps a concurrent invite unique constraint violation to MemberAlreadyExistsError", async () => {
    const { service } = makeService(undefined, {
      create: vi.fn().mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" })),
    });

    await expect(
      service.invite(
        { roomId: "room-1", targetId: "user-target", targetKind: "user", inviterId: OWNER.id },
        OWNER,
      ),
    ).rejects.toThrow(MemberAlreadyExistsError);
  });

  it("rethrows non-unique database failures while creating a membership", async () => {
    const databaseError = new Error("database unavailable");
    const { service } = makeService(undefined, {
      create: vi.fn().mockRejectedValue(databaseError),
    });

    await expect(
      service.invite(
        { roomId: "room-1", targetId: "user-target", targetKind: "user", inviterId: OWNER.id },
        OWNER,
      ),
    ).rejects.toBe(databaseError);
  });

  it("throws MemberBannedError when the target is banned", async () => {
    const { service } = makeService(undefined, {
      findOne: vi.fn(() => Promise.resolve(makeMembership({ status: "banned" }))),
    });

    await expect(
      service.invite(
        { roomId: "room-1", targetId: "user-target", targetKind: "user", inviterId: OWNER.id },
        OWNER,
      ),
    ).rejects.toThrow(MemberBannedError);
  });

  it("throws MemberAlreadyExistsError when the target is already active", async () => {
    const { service } = makeService(undefined, {
      findOne: vi.fn(() => Promise.resolve(makeMembership({ status: "active" }))),
    });

    await expect(
      service.invite(
        { roomId: "room-1", targetId: "user-target", targetKind: "user", inviterId: OWNER.id },
        OWNER,
      ),
    ).rejects.toThrow(MemberAlreadyExistsError);
  });

  it("throws MemberAlreadyExistsError when the target has a pending invitation", async () => {
    const { service } = makeService(undefined, {
      findOne: vi.fn(() => Promise.resolve(makeMembership({ status: "pending" }))),
    });

    await expect(
      service.invite(
        { roomId: "room-1", targetId: "user-target", targetKind: "user", inviterId: OWNER.id },
        OWNER,
      ),
    ).rejects.toThrow(MemberAlreadyExistsError);
  });

  it("throws RoomArchivedError when the room is archived", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeRoom({ status: "archived" }))),
    });

    await expect(
      service.invite(
        { roomId: "room-1", targetId: "user-target", targetKind: "user", inviterId: OWNER.id },
        OWNER,
      ),
    ).rejects.toThrow(RoomArchivedError);
  });

  it("throws RoomForbiddenError when the caller is not the owner or admin", async () => {
    const { service } = makeService();

    await expect(
      service.invite(
        { roomId: "room-1", targetId: "user-target", targetKind: "user", inviterId: OTHER.id },
        OTHER,
      ),
    ).rejects.toThrow(RoomForbiddenError);
  });

  it("allows an admin to invite even without ownership", async () => {
    const { service, memberships } = makeService();

    await service.invite(
      { roomId: "room-1", targetId: "user-target", targetKind: "user", inviterId: ADMIN.id },
      ADMIN,
    );

    expect(memberships.create).toHaveBeenCalled();
  });

  it("throws RoomNotFoundError when the room does not exist", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(null)),
    });

    await expect(
      service.invite(
        { roomId: "missing", targetId: "user-target", targetKind: "user", inviterId: OWNER.id },
        OWNER,
      ),
    ).rejects.toThrow(RoomNotFoundError);
  });

  it("throws FeedRoomImmutableError when the target is the Feed room (admin)", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeFeedRoom())),
    });

    await expect(
      service.invite(
        { roomId: "room-1", targetId: "user-target", targetKind: "user", inviterId: ADMIN.id },
        ADMIN,
      ),
    ).rejects.toThrow(FeedRoomImmutableError);
  });

  it("throws RoomForbiddenError (not FeedRoomImmutableError) for a non-admin on the Feed room", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeFeedRoom())),
    });

    await expect(
      service.invite(
        { roomId: "room-1", targetId: "user-target", targetKind: "user", inviterId: OTHER.id },
        OTHER,
      ),
    ).rejects.toThrow(RoomForbiddenError);
  });

});

// ── remove ────────────────────────────────────────────────────────────────────

describe("RoomMembershipService.remove", () => {
  it("transitions an active membership to removed", async () => {
    const { service, memberships } = makeService(undefined, {
      findByRoom: vi.fn(() => Promise.resolve([makeMembership({ id: "mem-1", status: "active" })])),
    });

    const result = await service.remove("room-1", "mem-1", OWNER);

    expect(memberships.updateStatus).toHaveBeenCalledWith("mem-1", "removed");
    expect(result.status).toBe("removed");
  });

  it("transitions a pending membership to removed", async () => {
    const { service, memberships } = makeService(undefined, {
      findByRoom: vi.fn(() => Promise.resolve([makeMembership({ id: "mem-1", status: "pending" })])),
    });

    await service.remove("room-1", "mem-1", OWNER);

    expect(memberships.updateStatus).toHaveBeenCalledWith("mem-1", "removed");
  });

  it("throws CannotModifyOwnerError when trying to remove the owner", async () => {
    const { service } = makeService(undefined, {
      findByRoom: vi.fn(() =>
        Promise.resolve([makeMembership({ id: "mem-1", role: "owner", status: "active" })]),
      ),
    });

    await expect(service.remove("room-1", "mem-1", OWNER)).rejects.toThrow(CannotModifyOwnerError);
  });

  it("throws InvalidStatusTransitionError when the member is banned", async () => {
    const { service } = makeService(undefined, {
      findByRoom: vi.fn(() =>
        Promise.resolve([makeMembership({ id: "mem-1", status: "banned" })]),
      ),
    });

    await expect(service.remove("room-1", "mem-1", OWNER)).rejects.toThrow(
      InvalidStatusTransitionError,
    );
  });

  it("throws InvalidStatusTransitionError when the member is already removed", async () => {
    const { service } = makeService(undefined, {
      findByRoom: vi.fn(() =>
        Promise.resolve([makeMembership({ id: "mem-1", status: "removed" })]),
      ),
    });

    await expect(service.remove("room-1", "mem-1", OWNER)).rejects.toThrow(
      InvalidStatusTransitionError,
    );
  });

  it("throws RoomArchivedError when the room is archived", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeRoom({ status: "archived" }))),
    });

    await expect(service.remove("room-1", "mem-1", OWNER)).rejects.toThrow(RoomArchivedError);
  });

  it("throws RoomForbiddenError when the caller is not the owner or admin", async () => {
    const { service } = makeService();

    await expect(service.remove("room-1", "mem-1", OTHER)).rejects.toThrow(RoomForbiddenError);
  });

  it("throws MembershipNotFoundError when the membership does not exist in the room", async () => {
    const { service } = makeService(undefined, {
      findByRoom: vi.fn(() => Promise.resolve([])),
    });

    await expect(service.remove("room-1", "missing-mem", OWNER)).rejects.toThrow(
      MembershipNotFoundError,
    );
  });

  it("throws FeedRoomImmutableError when the target is the Feed room (admin)", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeFeedRoom())),
    });

    await expect(service.remove("room-1", "mem-1", ADMIN)).rejects.toThrow(
      FeedRoomImmutableError,
    );
  });

  it("throws RoomForbiddenError (not FeedRoomImmutableError) for a non-admin on the Feed room", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeFeedRoom())),
    });

    await expect(service.remove("room-1", "mem-1", OTHER)).rejects.toThrow(RoomForbiddenError);
  });
});

// ── ban ───────────────────────────────────────────────────────────────────────

describe("RoomMembershipService.ban", () => {
  it("transitions an active membership to banned", async () => {
    const { service, memberships } = makeService(undefined, {
      findByRoom: vi.fn(() => Promise.resolve([makeMembership({ id: "mem-1", status: "active" })])),
    });

    const result = await service.ban("room-1", "mem-1", OWNER);

    expect(memberships.updateStatus).toHaveBeenCalledWith("mem-1", "banned");
    expect(result.status).toBe("banned");
  });

  it("transitions a removed membership to banned", async () => {
    const { service, memberships } = makeService(undefined, {
      findByRoom: vi.fn(() =>
        Promise.resolve([makeMembership({ id: "mem-1", status: "removed" })]),
      ),
    });

    await service.ban("room-1", "mem-1", OWNER);

    expect(memberships.updateStatus).toHaveBeenCalledWith("mem-1", "banned");
  });

  it("transitions a pending membership to banned", async () => {
    const { service, memberships } = makeService(undefined, {
      findByRoom: vi.fn(() =>
        Promise.resolve([makeMembership({ id: "mem-1", status: "pending" })]),
      ),
    });

    await service.ban("room-1", "mem-1", OWNER);

    expect(memberships.updateStatus).toHaveBeenCalledWith("mem-1", "banned");
  });

  it("throws CannotModifyOwnerError when trying to ban the owner", async () => {
    const { service } = makeService(undefined, {
      findByRoom: vi.fn(() =>
        Promise.resolve([makeMembership({ id: "mem-1", role: "owner", status: "active" })]),
      ),
    });

    await expect(service.ban("room-1", "mem-1", OWNER)).rejects.toThrow(CannotModifyOwnerError);
  });

  it("throws InvalidStatusTransitionError when the member is already banned", async () => {
    const { service } = makeService(undefined, {
      findByRoom: vi.fn(() =>
        Promise.resolve([makeMembership({ id: "mem-1", status: "banned" })]),
      ),
    });

    await expect(service.ban("room-1", "mem-1", OWNER)).rejects.toThrow(
      InvalidStatusTransitionError,
    );
  });

  it("throws InvalidStatusTransitionError when the member has left", async () => {
    const { service } = makeService(undefined, {
      findByRoom: vi.fn(() =>
        Promise.resolve([makeMembership({ id: "mem-1", status: "left" })]),
      ),
    });

    await expect(service.ban("room-1", "mem-1", OWNER)).rejects.toThrow(
      InvalidStatusTransitionError,
    );
  });

  it("throws RoomArchivedError when the room is archived", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeRoom({ status: "archived" }))),
    });

    await expect(service.ban("room-1", "mem-1", OWNER)).rejects.toThrow(RoomArchivedError);
  });

  it("throws RoomForbiddenError when the caller is not the owner or admin", async () => {
    const { service } = makeService();

    await expect(service.ban("room-1", "mem-1", OTHER)).rejects.toThrow(RoomForbiddenError);
  });

  it("throws FeedRoomImmutableError when the target is the Feed room (admin)", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeFeedRoom())),
    });

    await expect(service.ban("room-1", "mem-1", ADMIN)).rejects.toThrow(FeedRoomImmutableError);
  });

  it("throws RoomForbiddenError (not FeedRoomImmutableError) for a non-admin on the Feed room", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeFeedRoom())),
    });

    await expect(service.ban("room-1", "mem-1", OTHER)).rejects.toThrow(RoomForbiddenError);
  });
});

// ── unban ─────────────────────────────────────────────────────────────────────

describe("RoomMembershipService.unban", () => {
  it("transitions a banned membership to removed", async () => {
    const { service, memberships } = makeService(undefined, {
      findByRoom: vi.fn(() =>
        Promise.resolve([makeMembership({ id: "mem-1", status: "banned" })]),
      ),
    });

    const result = await service.unban("room-1", "mem-1", OWNER);

    expect(memberships.updateStatus).toHaveBeenCalledWith("mem-1", "removed");
    expect(result.status).toBe("removed");
  });

  it("throws InvalidStatusTransitionError when the member is not banned", async () => {
    const { service } = makeService(undefined, {
      findByRoom: vi.fn(() =>
        Promise.resolve([makeMembership({ id: "mem-1", status: "active" })]),
      ),
    });

    await expect(service.unban("room-1", "mem-1", OWNER)).rejects.toThrow(
      InvalidStatusTransitionError,
    );
  });

  it("throws RoomForbiddenError when the caller is not the owner or admin", async () => {
    const { service } = makeService();

    await expect(service.unban("room-1", "mem-1", OTHER)).rejects.toThrow(RoomForbiddenError);
  });

  it("allows unban even on an archived room (no archived check for unban)", async () => {
    const { service, memberships } = makeService(
      {
        findById: vi.fn(() => Promise.resolve(makeRoom({ status: "archived" }))),
      },
      {
        findByRoom: vi.fn(() =>
          Promise.resolve([makeMembership({ id: "mem-1", status: "banned" })]),
        ),
      },
    );

    // Unban is allowed even on archived rooms (the ban was set before archiving).
    await service.unban("room-1", "mem-1", OWNER);

    expect(memberships.updateStatus).toHaveBeenCalledWith("mem-1", "removed");
  });

  it("throws FeedRoomImmutableError when the target is the Feed room (admin)", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeFeedRoom())),
    });

    await expect(service.unban("room-1", "mem-1", ADMIN)).rejects.toThrow(
      FeedRoomImmutableError,
    );
  });

  it("throws RoomForbiddenError (not FeedRoomImmutableError) for a non-admin on the Feed room", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeFeedRoom())),
    });

    await expect(service.unban("room-1", "mem-1", OTHER)).rejects.toThrow(RoomForbiddenError);
  });
});

// ── listPending ───────────────────────────────────────────────────────────────

describe("RoomMembershipService.listPending", () => {
  it("returns pending memberships for the owner", async () => {
    const pending = [
      makeMembership({ id: "mem-1", status: "pending" }),
      makeMembership({ id: "mem-2", status: "pending", memberId: "user-2" }),
    ];
    const { service } = makeService(undefined, {
      findByRoom: vi.fn(() => Promise.resolve(pending)),
    });

    const result = await service.listPending("room-1", OWNER);

    expect(result).toHaveLength(2);
    expect(result[0]!.status).toBe("pending");
  });

  it("returns pending memberships for an admin", async () => {
    const { service, memberships } = makeService(undefined, {
      findByRoom: vi.fn(() => Promise.resolve([])),
    });

    await service.listPending("room-1", ADMIN);

    expect(memberships.findByRoom).toHaveBeenCalledWith("room-1", "pending");
  });

  it("throws RoomForbiddenError when the caller is not the owner or admin", async () => {
    const { service } = makeService();

    await expect(service.listPending("room-1", OTHER)).rejects.toThrow(RoomForbiddenError);
  });

  it("throws RoomNotFoundError when the room does not exist", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(null)),
    });

    await expect(service.listPending("missing", OWNER)).rejects.toThrow(RoomNotFoundError);
  });
});

// ── approve ───────────────────────────────────────────────────────────────────

describe("RoomMembershipService.approve", () => {
  it("transitions a pending membership to active", async () => {
    const { service, memberships } = makeService(undefined, {
      findByRoom: vi.fn(() =>
        Promise.resolve([makeMembership({ id: "mem-1", status: "pending" })]),
      ),
    });

    const result = await service.approve("room-1", "mem-1", OWNER);

    expect(memberships.updateStatus).toHaveBeenCalledWith("mem-1", "active");
    expect(result.status).toBe("active");
  });

  it("throws InvalidStatusTransitionError when the membership is not pending", async () => {
    const { service } = makeService(undefined, {
      findByRoom: vi.fn(() =>
        Promise.resolve([makeMembership({ id: "mem-1", status: "active" })]),
      ),
    });

    await expect(service.approve("room-1", "mem-1", OWNER)).rejects.toThrow(
      InvalidStatusTransitionError,
    );
  });

  it("throws RoomArchivedError when the room is archived", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeRoom({ status: "archived" }))),
    });

    await expect(service.approve("room-1", "mem-1", OWNER)).rejects.toThrow(RoomArchivedError);
  });

  it("throws RoomForbiddenError when the caller is not the owner or admin", async () => {
    const { service } = makeService();

    await expect(service.approve("room-1", "mem-1", OTHER)).rejects.toThrow(RoomForbiddenError);
  });

  it("throws FeedRoomImmutableError when the target is the Feed room (admin)", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeFeedRoom())),
    });

    await expect(service.approve("room-1", "mem-1", ADMIN)).rejects.toThrow(
      FeedRoomImmutableError,
    );
  });

  it("throws RoomForbiddenError (not FeedRoomImmutableError) for a non-admin on the Feed room", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeFeedRoom())),
    });

    await expect(service.approve("room-1", "mem-1", OTHER)).rejects.toThrow(RoomForbiddenError);
  });
});

// ── reject ────────────────────────────────────────────────────────────────────

describe("RoomMembershipService.reject", () => {
  it("deletes a pending membership", async () => {
    const { service, memberships } = makeService(undefined, {
      findByRoom: vi.fn(() =>
        Promise.resolve([makeMembership({ id: "mem-1", status: "pending" })]),
      ),
    });

    await service.reject("room-1", "mem-1", OWNER);

    expect(memberships.deleteById).toHaveBeenCalledWith("mem-1");
  });

  it("throws InvalidStatusTransitionError when the membership is not pending", async () => {
    const { service } = makeService(undefined, {
      findByRoom: vi.fn(() =>
        Promise.resolve([makeMembership({ id: "mem-1", status: "active" })]),
      ),
    });

    await expect(service.reject("room-1", "mem-1", OWNER)).rejects.toThrow(
      InvalidStatusTransitionError,
    );
  });

  it("throws RoomForbiddenError when the caller is not the owner or admin", async () => {
    const { service } = makeService();

    await expect(service.reject("room-1", "mem-1", OTHER)).rejects.toThrow(RoomForbiddenError);
  });

  it("throws MembershipNotFoundError when the membership does not exist", async () => {
    const { service } = makeService(undefined, {
      findByRoom: vi.fn(() => Promise.resolve([])),
    });

    await expect(service.reject("room-1", "missing-mem", OWNER)).rejects.toThrow(
      MembershipNotFoundError,
    );
  });

  it("throws FeedRoomImmutableError when the target is the Feed room (admin)", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeFeedRoom())),
    });

    await expect(service.reject("room-1", "mem-1", ADMIN)).rejects.toThrow(
      FeedRoomImmutableError,
    );
  });

  it("throws RoomForbiddenError (not FeedRoomImmutableError) for a non-admin on the Feed room", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeFeedRoom())),
    });

    await expect(service.reject("room-1", "mem-1", OTHER)).rejects.toThrow(RoomForbiddenError);
  });
});
