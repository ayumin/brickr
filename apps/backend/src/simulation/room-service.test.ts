/**
 * Tests for RoomService lifecycle and permissions (issue #151).
 *
 * Verifies:
 *   - create: room + owner membership created in a transaction
 *   - update: title update, visibility immutability, owner/admin only
 *   - archive: owner/admin only, global room rejected
 *   - delete: archived rooms only, owner/admin only
 *   - archiveOwnedBy: called on owner suspension
 */
import { describe, expect, it, vi } from "vitest";
import type { SimulationRepository } from "./simulation-repository.js";
import type { RoomMembershipRepository } from "./room-membership-repository.js";
import {
  RoomService,
  RoomNotFoundError,
  RoomForbiddenError,
  RoomArchivedError,
  RoomNotArchivedError,
  VisibilityImmutableError,
} from "./room-service.js";
import type { Simulation, SimulationActor } from "./simulation.js";
import { GLOBAL_SIMULATION_ID } from "@brickr/shared";
import { GlobalSimulationMutationError } from "./simulation-service.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const OWNER: SimulationActor = { id: "user-owner", isAdmin: false };
const ADMIN: SimulationActor = { id: "user-admin", isAdmin: true };
const OTHER: SimulationActor = { id: "user-other", isAdmin: false };

function makeRoom(overrides: Partial<Simulation> = {}): Simulation {
  return {
    id: "room-1",
    title: "テストルーム",
    status: "active",
    scope: "room",
    visibility: "public",
    tags: [],
    createdAt: new Date("2026-08-16T00:00:00.000Z"),
    lastActivityAt: new Date("2026-08-16T00:00:00.000Z"),
    createdByUserId: OWNER.id,
    ...overrides,
  };
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

function makeMembershipRepo(
  overrides: Partial<RoomMembershipRepository> = {},
): RoomMembershipRepository {
  return {
    create: vi.fn(),
    findByRoom: vi.fn(() => Promise.resolve([])),
    findByMember: vi.fn(() => Promise.resolve([])),
    findOne: vi.fn(() => Promise.resolve(null)),
    findActiveOwnerRooms: vi.fn(() => Promise.resolve([])),
    ...overrides,
  } as unknown as RoomMembershipRepository;
}

function makeService(
  simRepo?: Partial<SimulationRepository>,
  memRepo?: Partial<RoomMembershipRepository>,
): { service: RoomService; simulations: SimulationRepository; memberships: RoomMembershipRepository } {
  const simulations = makeSimulationRepo(simRepo);
  const memberships = makeMembershipRepo(memRepo);
  const service = new RoomService({ simulations, memberships });
  return { service, simulations, memberships };
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

  it("throws GlobalSimulationMutationError for the global room", async () => {
    const { service } = makeService({
      findById: vi.fn(() =>
        Promise.resolve(makeRoom({ id: GLOBAL_SIMULATION_ID, scope: "global" })),
      ),
    });

    await expect(
      service.update(GLOBAL_SIMULATION_ID, { title: "x" }, ADMIN),
    ).rejects.toThrow(GlobalSimulationMutationError);
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

  it("throws GlobalSimulationMutationError for the global room", async () => {
    const { service } = makeService({
      findById: vi.fn(() =>
        Promise.resolve(makeRoom({ id: GLOBAL_SIMULATION_ID, scope: "global" })),
      ),
    });

    await expect(service.archive(GLOBAL_SIMULATION_ID, ADMIN)).rejects.toThrow(
      GlobalSimulationMutationError,
    );
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

  it("throws GlobalSimulationMutationError for the global room", async () => {
    const { service } = makeService({
      findById: vi.fn(() =>
        Promise.resolve(makeRoom({ id: GLOBAL_SIMULATION_ID, scope: "global", status: "archived" })),
      ),
    });

    await expect(service.delete(GLOBAL_SIMULATION_ID, ADMIN)).rejects.toThrow(
      GlobalSimulationMutationError,
    );
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
