/**
 * Room lifecycle service (issue #151).
 *
 * Handles:
 *   - Room creation with automatic owner membership
 *   - Title updates (visibility is immutable after creation)
 *   - Archiving (owner/admin only)
 *   - Deletion of archived rooms (owner/admin only)
 *   - Owner-deactivation archive rule (called by UserAdminService on suspend)
 */
import type { RoomMembershipDto, RoomVisibility } from "@brickr/shared";
import { DomainError } from "../domain-error.js";
import type { SimulationRepository } from "./simulation-repository.js";
import type { RoomMembershipRepository } from "./room-membership-repository.js";
import {
  assertNotGlobalSimulation,
  isSimulationOwnerOrAdmin,
  toSimulationDto,
  type SimulationActor,
} from "./simulation-service.js";
import type { SimulationDto } from "@brickr/shared";

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

export class RoomNotFoundError extends DomainError {
  readonly httpStatus = 404;
  readonly errorCode = "room_not_found" as const;
  constructor(id: string) {
    super(`room "${id}" not found`);
  }
}

export class RoomForbiddenError extends DomainError {
  readonly httpStatus = 403;
  readonly errorCode = "forbidden" as const;
  constructor(id: string) {
    super(`not allowed to manage room "${id}"`);
  }
}

export class RoomArchivedError extends DomainError {
  readonly httpStatus = 409;
  readonly errorCode = "room_archived" as const;
  constructor(id: string) {
    super(`room "${id}" is archived`);
  }
}

export class RoomNotArchivedError extends DomainError {
  readonly httpStatus = 409;
  readonly errorCode = "room_archived" as const;
  constructor(id: string) {
    super(`room "${id}" must be archived before it can be deleted`);
  }
}

export class VisibilityImmutableError extends DomainError {
  readonly httpStatus = 422;
  readonly errorCode = "forbidden" as const;
  constructor() {
    super("room visibility cannot be changed after creation");
  }
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type CreateRoomInput = {
  title?: string | null;
  visibility?: RoomVisibility;
  createdByUserId: string;
};

export type UpdateRoomInput = {
  title?: string;
  /** Providing visibility is rejected — it is immutable after creation. */
  visibility?: RoomVisibility;
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export type RoomServiceDeps = {
  simulations: SimulationRepository;
  memberships: RoomMembershipRepository;
};

export class RoomService {
  constructor(private readonly deps: RoomServiceDeps) {}

  /**
   * Creates a room and grants the creator an active `owner` membership in a
   * single transaction. Visibility defaults to `public` and is fixed at creation.
   */
  async create(input: CreateRoomInput): Promise<SimulationDto> {
    const visibility: RoomVisibility = input.visibility ?? "public";
    const simulation = await this.deps.simulations.createWithOwner(
      input.title ?? null,
      visibility,
      input.createdByUserId,
    );
    return toSimulationDto(simulation);
  }

  /**
   * Updates a room's title. Visibility is immutable — passing it is an error.
   * Only the owner or an admin may update.
   */
  async update(
    id: string,
    input: UpdateRoomInput,
    actor: SimulationActor,
  ): Promise<SimulationDto> {
    if (input.visibility !== undefined) {
      throw new VisibilityImmutableError();
    }

    const simulation = await this.requireRoom(id);
    assertNotGlobalSimulation(simulation);
    this.assertOwnerOrAdmin(simulation, actor, id);

    if (simulation.status === "archived") {
      throw new RoomArchivedError(id);
    }

    if (input.title !== undefined) {
      const updated = await this.deps.simulations.updateTitle(id, input.title);
      return toSimulationDto(updated);
    }

    return toSimulationDto(simulation);
  }

  /**
   * Archives a room. Only the owner or an admin may archive.
   * The global room cannot be archived.
   */
  async archive(id: string, actor: SimulationActor): Promise<SimulationDto> {
    const simulation = await this.requireRoom(id);
    assertNotGlobalSimulation(simulation);
    this.assertOwnerOrAdmin(simulation, actor, id);

    const archived = await this.deps.simulations.updateStatus(id, "archived");
    return toSimulationDto(archived);
  }

  /**
   * Hard-deletes an archived room. Only the owner or an admin may delete.
   * The room must already be archived — active rooms must be archived first.
   */
  async delete(id: string, actor: SimulationActor): Promise<void> {
    const simulation = await this.requireRoom(id);
    assertNotGlobalSimulation(simulation);
    this.assertOwnerOrAdmin(simulation, actor, id);

    if (simulation.status !== "archived") {
      throw new RoomNotArchivedError(id);
    }

    await this.deps.simulations.delete(id);
  }

  /**
   * Archives all active rooms owned by the given user. Called when an owner's
   * account is suspended so their rooms do not remain active without an owner
   * (issue #151 — owner deactivation archive rule).
   */
  async archiveOwnedBy(userId: string): Promise<void> {
    await this.deps.simulations.archiveOwnedBy(userId);
  }

  /**
   * Returns the memberships for a room. Requires the caller to be a member or
   * an admin (enforced at the route layer).
   */
  async listMemberships(roomId: string): Promise<RoomMembershipDto[]> {
    const memberships = await this.deps.memberships.findByRoom(roomId);
    return memberships.map((m) => ({
      id: m.id,
      roomId: m.roomId,
      memberKind: m.memberKind,
      memberId: m.memberId,
      role: m.role,
      status: m.status,
      ...(m.invitedById ? { invitedById: m.invitedById } : {}),
      ...(m.invitedAt ? { invitedAt: m.invitedAt.toISOString() } : {}),
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    }));
  }

  // -- helpers ---------------------------------------------------------------

  private async requireRoom(id: string) {
    const simulation = await this.deps.simulations.findById(id);
    if (!simulation) throw new RoomNotFoundError(id);
    return simulation;
  }

  private assertOwnerOrAdmin(
    simulation: { createdByUserId?: string },
    actor: SimulationActor,
    id: string,
  ): void {
    if (!isSimulationOwnerOrAdmin(simulation, actor)) {
      throw new RoomForbiddenError(id);
    }
  }
}
