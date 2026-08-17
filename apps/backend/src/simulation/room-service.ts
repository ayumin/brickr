/**
 * Room lifecycle service (issue #151, #169).
 *
 * Handles:
 *   - Room creation with automatic owner membership
 *   - Title updates (visibility is immutable after creation)
 *   - Archiving (owner/admin only)
 *   - Deletion of archived rooms (owner/admin only)
 *   - Owner-deactivation archive rule (called by UserAdminService on suspend)
 *   - User join requests (public: auto-join; open: pending approval)
 *   - User invite by handle (owner/admin only)
 *   - Membership approval/rejection (owner/admin only)
 */
import type { RoomMembershipDto, RoomVisibility } from "@brickr/shared";
import { DomainError } from "../domain-error.js";
import type { SimulationRepository } from "./simulation-repository.js";
import type {
  RoomMembership,
  RoomMembershipRepository,
} from "./room-membership-repository.js";
import { CannotModifyOwnerError } from "./room-membership-errors.js";
import type { HandleRepository } from "../handles/handle-repository.js";
import {
  isSimulationOwnerOrAdmin,
  toSimulationDto,
  type SimulationActor,
} from "./simulation-service.js";
import type { Simulation } from "./simulation.js";
import type { RoomDto } from "@brickr/shared";

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
  readonly errorCode = "room_not_archived" as const;
  constructor(id: string) {
    super(`room "${id}" must be archived before it can be deleted`);
  }
}

export class VisibilityImmutableError extends DomainError {
  readonly httpStatus = 422;
  readonly errorCode = "visibility_immutable" as const;
  constructor() {
    super("room visibility cannot be changed after creation");
  }
}

export class FeedRoomImmutableError extends DomainError {
  readonly httpStatus = 403;
  readonly errorCode = "feed_room_immutable" as const;
  constructor() {
    super("the Feed room cannot be modified or deleted");
  }
}

export class RoomJoinNotAllowedError extends DomainError {
  readonly httpStatus = 403;
  readonly errorCode = "room_join_not_allowed" as const;
  constructor(id: string) {
    super(`cannot join room "${id}": invitation required`);
  }
}

export class RoomAlreadyMemberError extends DomainError {
  readonly httpStatus = 409;
  readonly errorCode = "room_already_member" as const;
  constructor(id: string) {
    super(`already a member of room "${id}"`);
  }
}

export class RoomMemberBannedError extends DomainError {
  readonly httpStatus = 403;
  readonly errorCode = "room_member_banned" as const;
  constructor(id: string) {
    super(`banned from room "${id}"`);
  }
}

export class UserNotFoundError extends DomainError {
  readonly httpStatus = 404;
  readonly errorCode = "user_not_found" as const;
  constructor(handle: string) {
    super(`user with handle "${handle}" not found`);
  }
}

export class RoomMembershipNotFoundError extends DomainError {
  readonly httpStatus = 404;
  readonly errorCode = "membership_not_found" as const;
  constructor() {
    super("membership not found");
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
  handles?: HandleRepository;
};

export class RoomService {
  constructor(private readonly deps: RoomServiceDeps) {}

  /**
   * Creates a room and grants the creator an active `owner` membership in a
   * single transaction. Visibility defaults to `public` and is fixed at creation.
   */
  async create(input: CreateRoomInput): Promise<RoomDto> {
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
  ): Promise<RoomDto> {
    if (input.visibility !== undefined) {
      throw new VisibilityImmutableError();
    }

    const simulation = await this.requireRoom(id);
    this.assertNotFeedRoom(simulation);
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
   */
  async archive(id: string, actor: SimulationActor): Promise<RoomDto> {
    const simulation = await this.requireRoom(id);
    this.assertNotFeedRoom(simulation);
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
    this.assertNotFeedRoom(simulation);
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
    const roomIds = await this.deps.memberships.findActiveOwnerRooms(userId);
    if (roomIds.length === 0) return;
    await this.deps.simulations.archiveByIds(roomIds);
  }

  /**
   * Returns the memberships for a room. Requires the caller to be a member or
   * an admin (enforced at the route layer).
   */
  async listMemberships(roomId: string): Promise<RoomMembershipDto[]> {
    const memberships = await this.deps.memberships.findByRoom(roomId);
    return memberships.map((m) => toMembershipDto(m));
  }

  /**
   * Requests to join a room (issue #169).
   *
   * - public rooms: auto-join (active membership immediately)
   * - open rooms: pending membership (owner approval required)
   * - closed/private rooms: invitation only — self-initiated join is rejected
   *
   * Banned members are always rejected. Already-active members get a 409.
   * Pending members (already requested) also get a 409.
   */
  async join(roomId: string, actor: SimulationActor): Promise<RoomMembershipDto> {
    const simulation = await this.requireRoom(roomId);
    this.assertNotFeedRoom(simulation);

    if (simulation.status === "archived") {
      throw new RoomArchivedError(roomId);
    }

    // closed/private: invitation only
    if (simulation.visibility === "closed" || simulation.visibility === "private") {
      throw new RoomJoinNotAllowedError(roomId);
    }

    // Check existing membership
    const existing = await this.deps.memberships.findOne(roomId, "user", actor.id);
    if (existing) {
      if (existing.status === "banned") throw new RoomMemberBannedError(roomId);
      if (existing.status === "active" || existing.status === "pending") {
        throw new RoomAlreadyMemberError(roomId);
      }
      // left/removed: allow re-join by updating status
      const status = simulation.visibility === "public" ? "active" : "pending";
      const updated = await this.deps.memberships.updateStatusByMember(
        roomId,
        "user",
        actor.id,
        status,
      );
      if (!updated) throw new RoomNotFoundError(roomId);
      return toMembershipDto(updated);
    }

    // No existing membership: create one
    const status = simulation.visibility === "public" ? "active" : "pending";
    const membership = await this.deps.memberships.create({
      roomId,
      memberKind: "user",
      memberId: actor.id,
      role: "member",
      status,
    });
    return toMembershipDto(membership);
  }

  /**
   * Invites a user (by handle) to a room (issue #169).
   *
   * Only the room owner or an admin may invite. The invited user gets an
   * active membership immediately (invitation bypasses the pending flow).
   */
  async inviteByHandle(
    roomId: string,
    handle: string,
    actor: SimulationActor,
  ): Promise<RoomMembershipDto> {
    const simulation = await this.requireRoom(roomId);
    this.assertNotFeedRoom(simulation);
    this.assertOwnerOrAdmin(simulation, actor, roomId);

    if (simulation.status === "archived") {
      throw new RoomArchivedError(roomId);
    }

    // Resolve the handle to a user id via the shared handle namespace
    if (!this.deps.handles) {
      throw new UserNotFoundError(handle);
    }
    const owner = await this.deps.handles.findByHandle(handle);
    if (!owner || owner.ownerType !== "user") throw new UserNotFoundError(handle);

    const userId = owner.ownerId;

    // Check existing membership
    const existing = await this.deps.memberships.findOne(roomId, "user", userId);
    if (existing) {
      if (existing.status === "banned") throw new RoomMemberBannedError(roomId);
      if (existing.status === "active") throw new RoomAlreadyMemberError(roomId);
      // pending/left/removed: upgrade to active
      const updated = await this.deps.memberships.reinviteByMember(
        roomId,
        "user",
        userId,
        actor.id,
      );
      if (!updated) throw new RoomNotFoundError(roomId);
      return toMembershipDto(updated);
    }

    const membership = await this.deps.memberships.create({
      roomId,
      memberKind: "user",
      memberId: userId,
      role: "member",
      status: "active",
      invitedById: actor.id,
    });
    return toMembershipDto(membership);
  }

  /**
   * Approves a pending membership (owner/admin only, issue #169).
   */
  async approveMembership(
    roomId: string,
    memberId: string,
    actor: SimulationActor,
  ): Promise<RoomMembershipDto> {
    const simulation = await this.requireRoom(roomId);
    this.assertNotFeedRoom(simulation);
    this.assertOwnerOrAdmin(simulation, actor, roomId);

    if (simulation.status === "archived") {
      throw new RoomArchivedError(roomId);
    }

    const updated = await this.deps.memberships.updateStatusByMember(
      roomId,
      "user",
      memberId,
      "active",
    );
    if (!updated) throw new RoomMembershipNotFoundError();
    return toMembershipDto(updated);
  }

  /**
   * Removes a membership (owner/admin only, issue #169).
   * Sets status to "removed". For banning, use `banMember`.
   */
  async removeMembership(
    roomId: string,
    memberId: string,
    actor: SimulationActor,
  ): Promise<void> {
    const simulation = await this.requireRoom(roomId);
    this.assertNotFeedRoom(simulation);
    this.assertOwnerOrAdmin(simulation, actor, roomId);

    if (simulation.status === "archived") {
      throw new RoomArchivedError(roomId);
    }
    this.assertNotOwnerMembership(simulation, memberId);

    const updated = await this.deps.memberships.updateStatusByMember(
      roomId,
      "user",
      memberId,
      "removed",
    );
    if (!updated) throw new RoomMembershipNotFoundError();
  }

  /**
   * Bans a member from a room (owner/admin only, issue #169).
   * Banned members cannot re-join.
   */
  async banMember(
    roomId: string,
    memberId: string,
    actor: SimulationActor,
  ): Promise<void> {
    const simulation = await this.requireRoom(roomId);
    this.assertNotFeedRoom(simulation);
    this.assertOwnerOrAdmin(simulation, actor, roomId);

    if (simulation.status === "archived") {
      throw new RoomArchivedError(roomId);
    }
    this.assertNotOwnerMembership(simulation, memberId);

    const updated = await this.deps.memberships.updateStatusByMember(
      roomId,
      "user",
      memberId,
      "banned",
    );
    if (!updated) throw new RoomMembershipNotFoundError();
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

  private assertNotOwnerMembership(
    simulation: { createdByUserId?: string },
    memberId: string,
  ): void {
    if (memberId === simulation.createdByUserId) {
      throw new CannotModifyOwnerError();
    }
  }

  /**
   * Rejects any mutating operation on the reserved Feed room.
   *
   * The Feed room (scope: 'global') is an internal singleton — its title,
   * lifecycle, and memberships must not be changed through the normal room
   * management API.
   */
  private assertNotFeedRoom(simulation: Pick<Simulation, "scope">): void {
    if (simulation.scope === "global") {
      throw new FeedRoomImmutableError();
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toMembershipDto(m: RoomMembership): RoomMembershipDto {
  return {
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
  };
}
