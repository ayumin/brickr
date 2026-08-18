/**
 * Tests for RoomService lifecycle and permissions (issues #151, #169, #176).
 *
 * Verifies:
 *   - create: room + owner membership created in a transaction
 *   - update: title update, visibility immutability, owner/admin only
 *   - archive: owner/admin only
 *   - delete: archived rooms only, owner/admin only
 *   - archiveOwnedBy: called on owner suspension
 *   - join: public auto-join, open pending(request), closed/private rejected
 *   - inviteByHandle: owner/admin only, handle resolution, pending(invitation) for closed/private
 *   - acceptInvitation / declineInvitation: invitee only
 *   - withdrawRequest: requester only
 *   - leave: active member only, owner cannot leave, Feed room cannot be left
 *   - approveMembership / removeMembership / banMember: owner/admin only
 */
import { describe, expect, it, vi } from "vitest";
import type { SimulationRepository } from "./simulation-repository.js";
import type { RoomMembershipRepository } from "./room-membership-repository.js";
import type { HandleRepository } from "../handles/handle-repository.js";
import {
  RoomService,
  RoomNotFoundError,
  RoomForbiddenError,
  RoomArchivedError,
  RoomNotArchivedError,
  RoomJoinNotAllowedError,
  RoomAlreadyMemberError,
  RoomMemberBannedError,
  UserNotFoundError,
  VisibilityImmutableError,
  InvitationNotFoundError,
  RequestNotFoundError,
  CannotLeaveFeedRoomError,
  NotAMemberError,
  OwnerCannotLeaveError,
} from "./room-service.js";
import { CannotModifyOwnerError } from "./room-membership-errors.js";
import { FeedRoomImmutableError } from "./feed-room-guard.js";
import type { Simulation, SimulationActor } from "./simulation.js";
import type { RoomMembership } from "./room-membership-repository.js";


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

function makeSimulationRepo(
  overrides: Partial<SimulationRepository> = {},
): SimulationRepository {
  return {
    create: vi.fn(),
    createWithOwner: vi.fn(() => Promise.resolve(makeRoom())),
    findById: vi.fn(() => Promise.resolve(makeRoom())),
    findSummaryById: vi.fn(),
    findAllVisibleTo: vi.fn(),
    updateTitle: vi.fn((id, title) =>
      Promise.resolve(makeRoom({ title })),
    ),
    updateStatus: vi.fn((id, status) =>
      Promise.resolve(makeRoom({ status })),
    ),
    delete: vi.fn(() => Promise.resolve()),
    archiveByIds: vi.fn(() => Promise.resolve()),
    ...overrides,
  } as unknown as SimulationRepository;
}

function makeMembership(overrides: Partial<RoomMembership> = {}): RoomMembership {
  return {
    id: "mem-1",
    roomId: "room-1",
    memberKind: "user",
    memberId: OTHER.id,
    role: "member",
    status: "active",
    createdAt: new Date("2026-08-16T00:00:00.000Z"),
    updatedAt: new Date("2026-08-16T00:00:00.000Z"),
    ...overrides,
  };
}



function makeMembershipRepo(
  overrides: Partial<RoomMembershipRepository> = {},
): RoomMembershipRepository {
  return {
    create: vi.fn((input) =>
      Promise.resolve(makeMembership({ memberId: input.memberId, status: input.status, role: input.role, origin: input.origin })),
    ),
    findByRoom: vi.fn(() => Promise.resolve([])),
    findByMember: vi.fn(() => Promise.resolve([])),
    findOne: vi.fn(() => Promise.resolve(null)),
    findById: vi.fn(() => Promise.resolve(null)),
    findActiveOwnerRooms: vi.fn(() => Promise.resolve([])),
    updateStatus: vi.fn((id, status) =>
      Promise.resolve(makeMembership({ id, status })),
    ),
    updateStatusByMember: vi.fn((_roomId, _memberKind, memberId, status, origin) =>
      Promise.resolve(makeMembership({ memberId, status, origin })),
    ),
    reinviteByMember: vi.fn((_roomId, _memberKind, memberId, invitedById) =>
      Promise.resolve(makeMembership({ memberId, status: "active", invitedById })),
    ),
    deleteById: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  } as unknown as RoomMembershipRepository;
}

function makeHandleRepo(
  overrides: Partial<HandleRepository> = {},
): HandleRepository {
  return {
    findByHandle: vi.fn((handle: string) => {
      if (handle === OTHER.id || handle === "other") {
        return Promise.resolve({ handle, ownerType: "user" as const, ownerId: OTHER.id });
      }
      return Promise.resolve(null);
    }),
    ...overrides,
  } as unknown as HandleRepository;
}

function makeService(
  simRepo?: Partial<SimulationRepository>,
  memRepo?: Partial<RoomMembershipRepository>,
  handleRepo?: Partial<HandleRepository>,
): { service: RoomService; simulations: SimulationRepository; memberships: RoomMembershipRepository; handles: HandleRepository } {
  const simulations = makeSimulationRepo(simRepo);
  const memberships = makeMembershipRepo(memRepo);
  const handles = makeHandleRepo(handleRepo);
  const service = new RoomService({ simulations, memberships, handles });
  return { service, simulations, memberships, handles };
}

// ── create ────────────────────────────────────────────────────────────────────

describe("RoomService.create", () => {
  it("creates a room with default public visibility", async () => {
    const { service, simulations } = makeService();

    const result = await service.create({ createdByUserId: OWNER.id });

    expect(simulations.createWithOwner).toHaveBeenCalledWith(null, "public", OWNER.id);
    expect(result).toMatchObject({ id: "room-1", status: "active", visibility: "public" });
  });

  it("creates a room with the specified visibility", async () => {
    const { service, simulations } = makeService({
      createWithOwner: vi.fn(() => Promise.resolve(makeRoom({ visibility: "closed" }))),
    });

    const result = await service.create({
      title: "プライベートルーム",
      visibility: "closed",
      createdByUserId: OWNER.id,
    });

    expect(simulations.createWithOwner).toHaveBeenCalledWith(
      "プライベートルーム",
      "closed",
      OWNER.id,
    );
    expect(result).toMatchObject({ visibility: "closed" });
  });

  it("passes the title to the repository", async () => {
    const { service, simulations } = makeService({
      createWithOwner: vi.fn(() => Promise.resolve(makeRoom({ title: "新しいルーム" }))),
    });

    await service.create({ title: "新しいルーム", createdByUserId: OWNER.id });

    expect(simulations.createWithOwner).toHaveBeenCalledWith("新しいルーム", "public", OWNER.id);
  });
});

// ── update ────────────────────────────────────────────────────────────────────

describe("RoomService.update", () => {
  it("updates the title when the caller is the owner", async () => {
    const { service, simulations } = makeService();

    const result = await service.update("room-1", { title: "新タイトル" }, OWNER);

    expect(simulations.updateTitle).toHaveBeenCalledWith("room-1", "新タイトル");
    expect(result).toMatchObject({ id: "room-1" });
  });

  it("updates the title when the caller is an admin", async () => {
    const { service, simulations } = makeService();

    await service.update("room-1", { title: "管理者変更" }, ADMIN);

    expect(simulations.updateTitle).toHaveBeenCalledWith("room-1", "管理者変更");
  });

  it("throws RoomForbiddenError when the caller is neither owner nor admin", async () => {
    const { service } = makeService();

    await expect(service.update("room-1", { title: "不正" }, OTHER)).rejects.toThrow(
      RoomForbiddenError,
    );
  });

  it("throws RoomNotFoundError when the room does not exist", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(null)),
    });

    await expect(service.update("missing", { title: "x" }, OWNER)).rejects.toThrow(
      RoomNotFoundError,
    );
  });

  it("throws VisibilityImmutableError when visibility is provided", async () => {
    const { service } = makeService();

    await expect(
      service.update("room-1", { title: "x", visibility: "closed" }, OWNER),
    ).rejects.toThrow(VisibilityImmutableError);
  });

  it("throws RoomArchivedError when the room is already archived", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeRoom({ status: "archived" }))),
    });

    await expect(service.update("room-1", { title: "x" }, OWNER)).rejects.toThrow(
      RoomArchivedError,
    );
  });

  it("throws FeedRoomImmutableError when the target is the Feed room (admin)", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeFeedRoom())),
    });

    await expect(service.update("room-1", { title: "x" }, ADMIN)).rejects.toThrow(
      FeedRoomImmutableError,
    );
  });

  it("throws RoomForbiddenError (not FeedRoomImmutableError) for a non-admin on the Feed room", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeFeedRoom())),
    });

    await expect(service.update("room-1", { title: "x" }, OTHER)).rejects.toThrow(
      RoomForbiddenError,
    );
  });

});

// ── archive ───────────────────────────────────────────────────────────────────

describe("RoomService.archive", () => {
  it("archives the room when the caller is the owner", async () => {
    const { service, simulations } = makeService();

    const result = await service.archive("room-1", OWNER);

    expect(simulations.updateStatus).toHaveBeenCalledWith("room-1", "archived");
    expect(result).toMatchObject({ id: "room-1" });
  });

  it("archives the room when the caller is an admin", async () => {
    const { service, simulations } = makeService();

    await service.archive("room-1", ADMIN);

    expect(simulations.updateStatus).toHaveBeenCalledWith("room-1", "archived");
  });

  it("throws RoomForbiddenError when the caller is neither owner nor admin", async () => {
    const { service } = makeService();

    await expect(service.archive("room-1", OTHER)).rejects.toThrow(RoomForbiddenError);
  });

  it("throws RoomNotFoundError when the room does not exist", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(null)),
    });

    await expect(service.archive("missing", OWNER)).rejects.toThrow(RoomNotFoundError);
  });

  it("throws FeedRoomImmutableError when the target is the Feed room (admin)", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeFeedRoom())),
    });

    await expect(service.archive("room-1", ADMIN)).rejects.toThrow(FeedRoomImmutableError);
  });

  it("throws RoomForbiddenError (not FeedRoomImmutableError) for a non-admin on the Feed room", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeFeedRoom())),
    });

    await expect(service.archive("room-1", OTHER)).rejects.toThrow(RoomForbiddenError);
  });

});

// ── delete ────────────────────────────────────────────────────────────────────

describe("RoomService.delete", () => {
  it("deletes an archived room when the caller is the owner", async () => {
    const { service, simulations } = makeService({
      findById: vi.fn(() => Promise.resolve(makeRoom({ status: "archived" }))),
    });

    await service.delete("room-1", OWNER);

    expect(simulations.delete).toHaveBeenCalledWith("room-1");
  });

  it("deletes an archived room when the caller is an admin", async () => {
    const { service, simulations } = makeService({
      findById: vi.fn(() => Promise.resolve(makeRoom({ status: "archived" }))),
    });

    await service.delete("room-1", ADMIN);

    expect(simulations.delete).toHaveBeenCalledWith("room-1");
  });

  it("throws RoomForbiddenError when the caller is neither owner nor admin", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeRoom({ status: "archived" }))),
    });

    await expect(service.delete("room-1", OTHER)).rejects.toThrow(RoomForbiddenError);
  });

  it("throws RoomNotFoundError when the room does not exist", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(null)),
    });

    await expect(service.delete("missing", OWNER)).rejects.toThrow(RoomNotFoundError);
  });

  it("throws RoomNotArchivedError when the room is still active", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeRoom({ status: "active" }))),
    });

    await expect(service.delete("room-1", OWNER)).rejects.toThrow(RoomNotArchivedError);
  });

  it("throws FeedRoomImmutableError when the target is the Feed room (admin)", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeFeedRoom({ status: "archived" }))),
    });

    await expect(service.delete("room-1", ADMIN)).rejects.toThrow(FeedRoomImmutableError);
  });

  it("throws RoomForbiddenError (not FeedRoomImmutableError) for a non-admin on the Feed room", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeFeedRoom({ status: "archived" }))),
    });

    await expect(service.delete("room-1", OTHER)).rejects.toThrow(RoomForbiddenError);
  });

});

// ── archiveOwnedBy ────────────────────────────────────────────────────────────

describe("RoomService.archiveOwnedBy", () => {
  it("archives rooms from active owner memberships rather than original creator ids", async () => {
    const { service, simulations, memberships } = makeService(undefined, {
      findActiveOwnerRooms: vi.fn(() => Promise.resolve(["room-transferred", "room-created"])),
    });

    await service.archiveOwnedBy("user-owner");

    expect(memberships.findActiveOwnerRooms).toHaveBeenCalledWith("user-owner");
    expect(simulations.archiveByIds).toHaveBeenCalledWith(["room-transferred", "room-created"]);
  });

  it("does not issue an empty archive update", async () => {
    const { service, simulations } = makeService();

    await service.archiveOwnedBy("user-without-rooms");

    expect(simulations.archiveByIds).not.toHaveBeenCalled();
  });
});

// ── join ──────────────────────────────────────────────────────────────────────

describe("RoomService.join", () => {
  it("creates an active membership for a public room", async () => {
    const { service, memberships } = makeService();

    const result = await service.join("room-1", OTHER);

    expect(memberships.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: "active", memberKind: "user", memberId: OTHER.id }),
    );
    expect(result.status).toBe("active");
  });

  it("creates a pending membership for an open room", async () => {
    const { service, memberships } = makeService({
      findById: vi.fn(() => Promise.resolve(makeRoom({ visibility: "open" }))),
    });

    const result = await service.join("room-1", OTHER);

    expect(memberships.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending" }),
    );
    expect(result.status).toBe("pending");
  });

  it("throws RoomJoinNotAllowedError for a closed room", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeRoom({ visibility: "closed" }))),
    });

    await expect(service.join("room-1", OTHER)).rejects.toThrow(RoomJoinNotAllowedError);
  });

  it("throws RoomJoinNotAllowedError for a private room", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeRoom({ visibility: "private" }))),
    });

    await expect(service.join("room-1", OTHER)).rejects.toThrow(RoomJoinNotAllowedError);
  });

  it("throws RoomArchivedError for an archived room", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeRoom({ status: "archived" }))),
    });

    await expect(service.join("room-1", OTHER)).rejects.toThrow(RoomArchivedError);
  });

  it("throws RoomAlreadyMemberError when already an active member", async () => {
    const { service } = makeService(undefined, {
      findOne: vi.fn(() => Promise.resolve(makeMembership({ status: "active" }))),
    });

    await expect(service.join("room-1", OTHER)).rejects.toThrow(RoomAlreadyMemberError);
  });

  it("throws RoomAlreadyMemberError when already pending", async () => {
    const { service } = makeService(undefined, {
      findOne: vi.fn(() => Promise.resolve(makeMembership({ status: "pending" }))),
    });

    await expect(service.join("room-1", OTHER)).rejects.toThrow(RoomAlreadyMemberError);
  });

  it("throws RoomMemberBannedError when banned", async () => {
    const { service } = makeService(undefined, {
      findOne: vi.fn(() => Promise.resolve(makeMembership({ status: "banned" }))),
    });

    await expect(service.join("room-1", OTHER)).rejects.toThrow(RoomMemberBannedError);
  });

  it("re-joins a left member by updating their status", async () => {
    const { service, memberships } = makeService(undefined, {
      findOne: vi.fn(() => Promise.resolve(makeMembership({ status: "left" }))),
    });

    const result = await service.join("room-1", OTHER);

    expect(memberships.updateStatusByMember).toHaveBeenCalledWith(
      "room-1",
      "user",
      OTHER.id,
      "active",
    );
    expect(result.status).toBe("active");
  });

  it("throws RoomNotFoundError when the room does not exist", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(null)),
    });

    await expect(service.join("missing", OTHER)).rejects.toThrow(RoomNotFoundError);
  });

  it("throws FeedRoomImmutableError when the target is the Feed room", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeFeedRoom())),
    });

    await expect(service.join("room-1", OTHER)).rejects.toThrow(FeedRoomImmutableError);
  });
});

// ── inviteByHandle ────────────────────────────────────────────────────────────

describe("RoomService.inviteByHandle", () => {
  it("creates an active membership for the invited user (owner)", async () => {
    const { service, memberships } = makeService();

    const result = await service.inviteByHandle("room-1", "other", OWNER);

    expect(memberships.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "active",
        memberKind: "user",
        memberId: OTHER.id,
        invitedById: OWNER.id,
      }),
    );
    expect(result.status).toBe("active");
  });

  it("creates an active membership for the invited user (admin)", async () => {
    const { service, memberships } = makeService();

    await service.inviteByHandle("room-1", "other", ADMIN);

    expect(memberships.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: "active", memberId: OTHER.id }),
    );
  });

  it("throws RoomForbiddenError when the caller is neither owner nor admin", async () => {
    const { service } = makeService();

    await expect(service.inviteByHandle("room-1", "other", OTHER)).rejects.toThrow(
      RoomForbiddenError,
    );
  });

  it("throws UserNotFoundError when the handle does not exist", async () => {
    const { service } = makeService(undefined, undefined, {
      findByHandle: vi.fn(() => Promise.resolve(null)),
    });

    await expect(service.inviteByHandle("room-1", "nobody", OWNER)).rejects.toThrow(
      UserNotFoundError,
    );
  });

  it("throws UserNotFoundError when the handle belongs to a character, not a user", async () => {
    const { service } = makeService(undefined, undefined, {
      findByHandle: vi.fn(() =>
        Promise.resolve({ handle: "cast", ownerType: "character" as const, ownerId: "cast-1" }),
      ),
    });

    await expect(service.inviteByHandle("room-1", "cast", OWNER)).rejects.toThrow(
      UserNotFoundError,
    );
  });

  it("throws RoomArchivedError for an archived room", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeRoom({ status: "archived" }))),
    });

    await expect(service.inviteByHandle("room-1", "other", OWNER)).rejects.toThrow(
      RoomArchivedError,
    );
  });

  it("throws RoomAlreadyMemberError when the user is already an active member", async () => {
    const { service } = makeService(undefined, {
      findOne: vi.fn(() => Promise.resolve(makeMembership({ status: "active" }))),
    });

    await expect(service.inviteByHandle("room-1", "other", OWNER)).rejects.toThrow(
      RoomAlreadyMemberError,
    );
  });

  it("upgrades a pending membership to active on invite", async () => {
    const { service, memberships } = makeService(undefined, {
      findOne: vi.fn(() => Promise.resolve(makeMembership({ status: "pending" }))),
    });

    const result = await service.inviteByHandle("room-1", "other", OWNER);

    expect(memberships.reinviteByMember).toHaveBeenCalledWith(
      "room-1",
      "user",
      OTHER.id,
      OWNER.id,
    );
    expect(result.status).toBe("active");
  });

  it("throws FeedRoomImmutableError when the target is the Feed room (owner-equivalent admin)", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeFeedRoom())),
    });

    await expect(service.inviteByHandle("room-1", "other", ADMIN)).rejects.toThrow(
      FeedRoomImmutableError,
    );
  });

  it("throws RoomForbiddenError (not FeedRoomImmutableError) for a non-admin on the Feed room", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeFeedRoom())),
    });

    await expect(service.inviteByHandle("room-1", "other", OTHER)).rejects.toThrow(
      RoomForbiddenError,
    );
  });
});

// ── approveMembership ─────────────────────────────────────────────────────────

describe("RoomService.approveMembership", () => {
  it("approves a pending membership (owner)", async () => {
    const { service, memberships } = makeService();

    const result = await service.approveMembership("room-1", OTHER.id, OWNER);

    expect(memberships.updateStatusByMember).toHaveBeenCalledWith(
      "room-1",
      "user",
      OTHER.id,
      "active",
    );
    expect(result.status).toBe("active");
  });

  it("approves a pending membership (admin)", async () => {
    const { service, memberships } = makeService();

    await service.approveMembership("room-1", OTHER.id, ADMIN);

    expect(memberships.updateStatusByMember).toHaveBeenCalledWith(
      "room-1",
      "user",
      OTHER.id,
      "active",
    );
  });

  it("throws RoomForbiddenError when the caller is neither owner nor admin", async () => {
    const { service } = makeService();

    await expect(service.approveMembership("room-1", OTHER.id, OTHER)).rejects.toThrow(
      RoomForbiddenError,
    );
  });

  it("throws FeedRoomImmutableError when the target is the Feed room (admin)", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeFeedRoom())),
    });

    await expect(service.approveMembership("room-1", OTHER.id, ADMIN)).rejects.toThrow(
      FeedRoomImmutableError,
    );
  });

  it("throws RoomForbiddenError (not FeedRoomImmutableError) for a non-admin on the Feed room", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeFeedRoom())),
    });

    await expect(service.approveMembership("room-1", OTHER.id, OTHER)).rejects.toThrow(
      RoomForbiddenError,
    );
  });
});

// ── removeMembership ──────────────────────────────────────────────────────────

describe("RoomService.removeMembership", () => {
  it("removes a membership (owner)", async () => {
    const { service, memberships } = makeService();

    await service.removeMembership("room-1", OTHER.id, OWNER);

    expect(memberships.updateStatusByMember).toHaveBeenCalledWith(
      "room-1",
      "user",
      OTHER.id,
      "removed",
    );
  });

  it("throws RoomForbiddenError when the caller is neither owner nor admin", async () => {
    const { service } = makeService();

    await expect(service.removeMembership("room-1", OTHER.id, OTHER)).rejects.toThrow(
      RoomForbiddenError,
    );
  });

  it("refuses to remove the owner's membership", async () => {
    const { service, memberships } = makeService();

    await expect(service.removeMembership("room-1", OWNER.id, ADMIN)).rejects.toThrow(
      CannotModifyOwnerError,
    );
    expect(memberships.updateStatusByMember).not.toHaveBeenCalled();
  });

  it("throws FeedRoomImmutableError when the target is the Feed room (admin)", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeFeedRoom())),
    });

    await expect(service.removeMembership("room-1", OTHER.id, ADMIN)).rejects.toThrow(
      FeedRoomImmutableError,
    );
  });

  it("throws RoomForbiddenError (not FeedRoomImmutableError) for a non-admin on the Feed room", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeFeedRoom())),
    });

    await expect(service.removeMembership("room-1", OTHER.id, OTHER)).rejects.toThrow(
      RoomForbiddenError,
    );
  });

});

// ── banMember ─────────────────────────────────────────────────────────────────

describe("RoomService.banMember", () => {
  it("bans a member (owner)", async () => {
    const { service, memberships } = makeService();

    await service.banMember("room-1", OTHER.id, OWNER);

    expect(memberships.updateStatusByMember).toHaveBeenCalledWith(
      "room-1",
      "user",
      OTHER.id,
      "banned",
    );
  });

  it("bans a member (admin)", async () => {
    const { service, memberships } = makeService();

    await service.banMember("room-1", OTHER.id, ADMIN);

    expect(memberships.updateStatusByMember).toHaveBeenCalledWith(
      "room-1",
      "user",
      OTHER.id,
      "banned",
    );
  });

  it("throws RoomForbiddenError when the caller is neither owner nor admin", async () => {
    const { service } = makeService();

    await expect(service.banMember("room-1", OTHER.id, OTHER)).rejects.toThrow(
      RoomForbiddenError,
    );
  });

  it("refuses to ban the owner's membership", async () => {
    const { service, memberships } = makeService();

    await expect(service.banMember("room-1", OWNER.id, ADMIN)).rejects.toThrow(
      CannotModifyOwnerError,
    );
    expect(memberships.updateStatusByMember).not.toHaveBeenCalled();
  });

  it("throws FeedRoomImmutableError when the target is the Feed room (admin)", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeFeedRoom())),
    });

    await expect(service.banMember("room-1", OTHER.id, ADMIN)).rejects.toThrow(
      FeedRoomImmutableError,
    );
  });

  it("throws RoomForbiddenError (not FeedRoomImmutableError) for a non-admin on the Feed room", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeFeedRoom())),
    });

    await expect(service.banMember("room-1", OTHER.id, OTHER)).rejects.toThrow(
      RoomForbiddenError,
    );
  });

});

// ── join (origin field) ───────────────────────────────────────────────────────

describe("RoomService.join — origin field", () => {
  it("creates a pending(request) membership for an open room", async () => {
    const { service, memberships } = makeService({
      findById: vi.fn(() => Promise.resolve(makeRoom({ visibility: "open" }))),
    });

    const result = await service.join("room-1", OTHER);

    expect(memberships.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", origin: "request" }),
    );
    expect(result.status).toBe("pending");
  });

  it("does not set origin for a public room (active membership)", async () => {
    const { service, memberships } = makeService();

    await service.join("room-1", OTHER);

    expect(memberships.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: "active" }),
    );
    // origin should not be set for active memberships
    const call = (memberships.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.origin).toBeUndefined();
  });

  it("restores a previous open-room membership as pending(request)", async () => {
    const { service, memberships } = makeService(
      { findById: vi.fn(() => Promise.resolve(makeRoom({ visibility: "open" }))) },
      { findOne: vi.fn(() => Promise.resolve(makeMembership({ status: "left" }))) },
    );

    const result = await service.join("room-1", OTHER);

    expect(memberships.updateStatusByMember).toHaveBeenCalledWith(
      "room-1",
      "user",
      OTHER.id,
      "pending",
      "request",
    );
    expect(result).toMatchObject({ status: "pending", origin: "request" });
  });
});

// ── inviteByHandle (pending invitation for closed/private) ───────────────────

describe("RoomService.inviteByHandle — pending invitation", () => {
  it("creates a pending(invitation) membership for a closed room", async () => {
    const { service, memberships } = makeService({
      findById: vi.fn(() => Promise.resolve(makeRoom({ visibility: "closed" }))),
    });

    const result = await service.inviteByHandle("room-1", "other", OWNER);

    expect(memberships.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "pending",
        origin: "invitation",
        invitedById: OWNER.id,
      }),
    );
    expect(result.status).toBe("pending");
  });

  it("creates a pending(invitation) membership for a private room", async () => {
    const { service, memberships } = makeService({
      findById: vi.fn(() => Promise.resolve(makeRoom({ visibility: "private" }))),
    });

    await service.inviteByHandle("room-1", "other", OWNER);

    expect(memberships.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", origin: "invitation" }),
    );
  });

  it("creates an active membership for a public room (no pending)", async () => {
    const { service, memberships } = makeService();

    const result = await service.inviteByHandle("room-1", "other", OWNER);

    expect(memberships.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: "active" }),
    );
    expect(result.status).toBe("active");
  });

  it("upgrades a pending(request) membership to active when owner invites", async () => {
    const { service, memberships } = makeService(undefined, {
      findOne: vi.fn(() =>
        Promise.resolve(makeMembership({ status: "pending", origin: "request" })),
      ),
    });

    const result = await service.inviteByHandle("room-1", "other", OWNER);

    expect(memberships.reinviteByMember).toHaveBeenCalledWith(
      "room-1",
      "user",
      OTHER.id,
      OWNER.id,
    );
    expect(result.status).toBe("active");
  });
});

// ── acceptInvitation ──────────────────────────────────────────────────────────

describe("RoomService.acceptInvitation", () => {
  it("transitions a pending(invitation) membership to active", async () => {
    const { service, memberships } = makeService(undefined, {
      findOne: vi.fn(() =>
        Promise.resolve(makeMembership({ status: "pending", origin: "invitation" })),
      ),
    });

    const result = await service.acceptInvitation("room-1", OTHER);

    expect(memberships.updateStatusByMember).toHaveBeenCalledWith(
      "room-1",
      "user",
      OTHER.id,
      "active",
    );
    expect(result.status).toBe("active");
  });

  it("throws InvitationNotFoundError when no pending invitation exists", async () => {
    const { service } = makeService(undefined, {
      findOne: vi.fn(() => Promise.resolve(null)),
    });

    await expect(service.acceptInvitation("room-1", OTHER)).rejects.toThrow(
      InvitationNotFoundError,
    );
  });

  it("throws InvitationNotFoundError when the pending membership is a request (not invitation)", async () => {
    const { service } = makeService(undefined, {
      findOne: vi.fn(() =>
        Promise.resolve(makeMembership({ status: "pending", origin: "request" })),
      ),
    });

    await expect(service.acceptInvitation("room-1", OTHER)).rejects.toThrow(
      InvitationNotFoundError,
    );
  });

  it("throws InvitationNotFoundError when the membership is active (not pending)", async () => {
    const { service } = makeService(undefined, {
      findOne: vi.fn(() => Promise.resolve(makeMembership({ status: "active" }))),
    });

    await expect(service.acceptInvitation("room-1", OTHER)).rejects.toThrow(
      InvitationNotFoundError,
    );
  });

  it("throws RoomArchivedError for an archived room", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeRoom({ status: "archived" }))),
    });

    await expect(service.acceptInvitation("room-1", OTHER)).rejects.toThrow(RoomArchivedError);
  });

  it("throws RoomNotFoundError when the room does not exist", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(null)),
    });

    await expect(service.acceptInvitation("missing", OTHER)).rejects.toThrow(RoomNotFoundError);
  });
});

// ── declineInvitation ─────────────────────────────────────────────────────────

describe("RoomService.declineInvitation", () => {
  it("deletes a pending(invitation) membership", async () => {
    const { service, memberships } = makeService(undefined, {
      findOne: vi.fn(() =>
        Promise.resolve(makeMembership({ status: "pending", origin: "invitation" })),
      ),
    });

    await service.declineInvitation("room-1", OTHER);

    expect(memberships.deleteById).toHaveBeenCalledWith("mem-1");
  });

  it("throws InvitationNotFoundError when no pending invitation exists", async () => {
    const { service } = makeService(undefined, {
      findOne: vi.fn(() => Promise.resolve(null)),
    });

    await expect(service.declineInvitation("room-1", OTHER)).rejects.toThrow(
      InvitationNotFoundError,
    );
  });

  it("throws InvitationNotFoundError when the pending membership is a request (not invitation)", async () => {
    const { service } = makeService(undefined, {
      findOne: vi.fn(() =>
        Promise.resolve(makeMembership({ status: "pending", origin: "request" })),
      ),
    });

    await expect(service.declineInvitation("room-1", OTHER)).rejects.toThrow(
      InvitationNotFoundError,
    );
  });

  it("throws RoomNotFoundError when the room does not exist", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(null)),
    });

    await expect(service.declineInvitation("missing", OTHER)).rejects.toThrow(RoomNotFoundError);
  });
});

// ── withdrawRequest ───────────────────────────────────────────────────────────

describe("RoomService.withdrawRequest", () => {
  it("deletes a pending(request) membership", async () => {
    const { service, memberships } = makeService(undefined, {
      findOne: vi.fn(() =>
        Promise.resolve(makeMembership({ status: "pending", origin: "request" })),
      ),
    });

    await service.withdrawRequest("room-1", OTHER);

    expect(memberships.deleteById).toHaveBeenCalledWith("mem-1");
  });

  it("throws RequestNotFoundError when no pending request exists", async () => {
    const { service } = makeService(undefined, {
      findOne: vi.fn(() => Promise.resolve(null)),
    });

    await expect(service.withdrawRequest("room-1", OTHER)).rejects.toThrow(RequestNotFoundError);
  });

  it("throws RequestNotFoundError when the pending membership is an invitation (not request)", async () => {
    const { service } = makeService(undefined, {
      findOne: vi.fn(() =>
        Promise.resolve(makeMembership({ status: "pending", origin: "invitation" })),
      ),
    });

    await expect(service.withdrawRequest("room-1", OTHER)).rejects.toThrow(RequestNotFoundError);
  });

  it("throws RequestNotFoundError when the membership is active (not pending)", async () => {
    const { service } = makeService(undefined, {
      findOne: vi.fn(() => Promise.resolve(makeMembership({ status: "active" }))),
    });

    await expect(service.withdrawRequest("room-1", OTHER)).rejects.toThrow(RequestNotFoundError);
  });

  it("throws RoomNotFoundError when the room does not exist", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(null)),
    });

    await expect(service.withdrawRequest("missing", OTHER)).rejects.toThrow(RoomNotFoundError);
  });
});

// ── leave ─────────────────────────────────────────────────────────────────────

describe("RoomService.leave", () => {
  it("transitions an active membership to left", async () => {
    const { service, memberships } = makeService(undefined, {
      findOne: vi.fn(() => Promise.resolve(makeMembership({ status: "active", role: "member" }))),
    });

    await service.leave("room-1", OTHER);

    expect(memberships.updateStatusByMember).toHaveBeenCalledWith(
      "room-1",
      "user",
      OTHER.id,
      "left",
    );
  });

  it("throws NotAMemberError when the user is not an active member", async () => {
    const { service } = makeService(undefined, {
      findOne: vi.fn(() => Promise.resolve(null)),
    });

    await expect(service.leave("room-1", OTHER)).rejects.toThrow(NotAMemberError);
  });

  it("throws NotAMemberError when the membership is pending (not active)", async () => {
    const { service } = makeService(undefined, {
      findOne: vi.fn(() => Promise.resolve(makeMembership({ status: "pending" }))),
    });

    await expect(service.leave("room-1", OTHER)).rejects.toThrow(NotAMemberError);
  });

  it("throws NotAMemberError when the membership is left", async () => {
    const { service } = makeService(undefined, {
      findOne: vi.fn(() => Promise.resolve(makeMembership({ status: "left" }))),
    });

    await expect(service.leave("room-1", OTHER)).rejects.toThrow(NotAMemberError);
  });

  it("throws OwnerCannotLeaveError when the owner tries to leave", async () => {
    const { service } = makeService(undefined, {
      findOne: vi.fn(() =>
        Promise.resolve(makeMembership({ status: "active", role: "owner", memberId: OWNER.id })),
      ),
    });

    await expect(service.leave("room-1", OWNER)).rejects.toThrow(OwnerCannotLeaveError);
  });

  it("throws CannotLeaveFeedRoomError when trying to leave the Feed room", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(makeFeedRoom())),
    });

    await expect(service.leave("room-1", OTHER)).rejects.toThrow(CannotLeaveFeedRoomError);
  });

  it("throws RoomNotFoundError when the room does not exist", async () => {
    const { service } = makeService({
      findById: vi.fn(() => Promise.resolve(null)),
    });

    await expect(service.leave("missing", OTHER)).rejects.toThrow(RoomNotFoundError);
  });
});
