/**
 * Room membership management service (issue #154).
 *
 * Handles:
 *   - Owner inviting a User or Cast (Character) to a room
 *   - Owner removing a member (active → removed)
 *   - Owner banning a member (active/removed → banned)
 *   - Owner unbanning a member (banned → removed)
 *   - Listing pending memberships (owner only)
 *   - Approving a pending membership (pending → active)
 *   - Rejecting a pending membership (pending → deleted)
 *
 * Authorization rules enforced here:
 *   - Only the room owner (or admin) may invite, remove, ban, unban, or manage pending.
 *   - Archived rooms reject all membership mutations.
 *   - A banned member may only transition to `removed` (unban), not directly to `active`.
 *   - The owner membership itself cannot be removed or banned.
 */
import type { MemberKind, RoomMembershipDto } from "@brickr/shared";
import { DomainError } from "../domain-error.js";
import { isUniqueConstraintError } from "../persistence/prisma.js";
import type { SimulationRepository } from "./simulation-repository.js";
import type { RoomMembershipRepository } from "./room-membership-repository.js";
import type { RoomMembership } from "./room-membership-repository.js";
import {
  assertNotGlobalSimulation,
  isSimulationOwnerOrAdmin,
  type SimulationActor,
} from "./simulation-service.js";
import { RoomNotFoundError, RoomArchivedError, RoomForbiddenError } from "./room-service.js";

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

export class MembershipNotFoundError extends DomainError {
  readonly httpStatus = 404;
  readonly errorCode = "membership_not_found" as const;
  constructor(id: string) {
    super(`membership "${id}" not found`);
  }
}

export class MemberAlreadyExistsError extends DomainError {
  readonly httpStatus = 409;
  readonly errorCode = "member_already_exists" as const;
  constructor() {
    super("the target is already a member or has a pending invitation");
  }
}

export class MemberBannedError extends DomainError {
  readonly httpStatus = 409;
  readonly errorCode = "member_banned" as const;
  constructor() {
    super("banned members cannot be invited; unban them first");
  }
}

export class CannotModifyOwnerError extends DomainError {
  readonly httpStatus = 409;
  readonly errorCode = "cannot_modify_owner" as const;
  constructor() {
    super("the room owner's membership cannot be removed or banned");
  }
}

export class InvalidStatusTransitionError extends DomainError {
  readonly httpStatus = 409;
  readonly errorCode = "invalid_status_transition" as const;
  constructor(from: string, to: string) {
    super(`cannot transition membership from "${from}" to "${to}"`);
  }
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type InviteInput = {
  roomId: string;
  targetId: string;
  targetKind: MemberKind;
  inviterId: string;
};

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function toDto(m: RoomMembership): RoomMembershipDto {
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

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export type RoomMembershipServiceDeps = {
  simulations: SimulationRepository;
  memberships: RoomMembershipRepository;
};

export class RoomMembershipService {
  constructor(private readonly deps: RoomMembershipServiceDeps) {}

  /**
   * Invites a User or Character to a room.
   *
   * Visibility rules:
   *   - public / open: invitation creates an `active` membership directly
   *     (the owner is bypassing the normal join flow).
   *   - closed / private: invitation creates a `pending` membership that the
   *     invitee must accept (or the owner approves on their behalf).
   *
   * For simplicity in Phase 2, all owner invitations create `active` memberships
   * immediately, regardless of visibility. The pending flow is for self-initiated
   * join requests (issue #153).
   *
   * Restrictions:
   *   - Archived rooms reject invitations.
   *   - Banned members must be unbanned before they can be re-invited.
   *   - Members who are already active or pending are rejected.
   */
  async invite(input: InviteInput, actor: SimulationActor): Promise<RoomMembershipDto> {
    const room = await this.requireRoom(input.roomId);
    assertNotGlobalSimulation(room);
    this.assertOwnerOrAdmin(room, actor, input.roomId);

    if (room.status === "archived") {
      throw new RoomArchivedError(input.roomId);
    }

    // Check for an existing membership row.
    const existing = await this.deps.memberships.findOne(
      input.roomId,
      input.targetKind,
      input.targetId,
    );

    if (existing) {
      if (existing.status === "banned") {
        throw new MemberBannedError();
      }
      if (existing.status === "active" || existing.status === "pending") {
        throw new MemberAlreadyExistsError();
      }
      // left / removed: re-invite by updating to active.
      const updated = await this.deps.memberships.reinviteByMember(
        input.roomId,
        input.targetKind,
        input.targetId,
        actor.id,
      );
      if (!updated) throw new MembershipNotFoundError(existing.id);
      return toDto(updated);
    }

    // No existing row: create a fresh active membership.
    try {
      const membership = await this.deps.memberships.create({
        roomId: input.roomId,
        memberKind: input.targetKind,
        memberId: input.targetId,
        role: "member",
        status: "active",
        invitedById: actor.id,
      });
      return toDto(membership);
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new MemberAlreadyExistsError();
      throw error;
    }
  }

  /**
   * Removes an active (or pending) member from a room (active/pending → removed).
   * The owner's own membership cannot be removed.
   */
  async remove(
    roomId: string,
    membershipId: string,
    actor: SimulationActor,
  ): Promise<RoomMembershipDto> {
    const room = await this.requireRoom(roomId);
    assertNotGlobalSimulation(room);
    this.assertOwnerOrAdmin(room, actor, roomId);

    if (room.status === "archived") {
      throw new RoomArchivedError(roomId);
    }

    const membership = await this.requireMembership(membershipId, roomId);

    if (membership.role === "owner") {
      throw new CannotModifyOwnerError();
    }

    if (membership.status === "banned") {
      throw new InvalidStatusTransitionError("banned", "removed via remove — use unban instead");
    }

    if (membership.status === "removed") {
      throw new InvalidStatusTransitionError("removed", "removed");
    }

    if (membership.status === "left") {
      throw new InvalidStatusTransitionError("left", "removed");
    }

    const updated = await this.deps.memberships.updateStatus(membershipId, "removed");
    if (!updated) throw new MembershipNotFoundError(membershipId);
    return toDto(updated);
  }

  /**
   * Bans a member (active/removed/pending → banned).
   * The owner's own membership cannot be banned.
   */
  async ban(
    roomId: string,
    membershipId: string,
    actor: SimulationActor,
  ): Promise<RoomMembershipDto> {
    const room = await this.requireRoom(roomId);
    assertNotGlobalSimulation(room);
    this.assertOwnerOrAdmin(room, actor, roomId);

    if (room.status === "archived") {
      throw new RoomArchivedError(roomId);
    }

    const membership = await this.requireMembership(membershipId, roomId);

    if (membership.role === "owner") {
      throw new CannotModifyOwnerError();
    }

    if (membership.status === "banned") {
      throw new InvalidStatusTransitionError("banned", "banned");
    }

    if (membership.status === "left") {
      throw new InvalidStatusTransitionError("left", "banned");
    }

    const updated = await this.deps.memberships.updateStatus(membershipId, "banned");
    if (!updated) throw new MembershipNotFoundError(membershipId);
    return toDto(updated);
  }

  /**
   * Unbans a member (banned → removed).
   * After unbanning, the member may re-join or be re-invited.
   */
  async unban(
    roomId: string,
    membershipId: string,
    actor: SimulationActor,
  ): Promise<RoomMembershipDto> {
    const room = await this.requireRoom(roomId);
    assertNotGlobalSimulation(room);
    this.assertOwnerOrAdmin(room, actor, roomId);

    const membership = await this.requireMembership(membershipId, roomId);

    if (membership.status !== "banned") {
      throw new InvalidStatusTransitionError(membership.status, "removed (unban)");
    }

    const updated = await this.deps.memberships.updateStatus(membershipId, "removed");
    if (!updated) throw new MembershipNotFoundError(membershipId);
    return toDto(updated);
  }

  /**
   * Lists all pending memberships for a room (owner/admin only).
   * Used to display the pending badge and approval queue.
   */
  async listPending(
    roomId: string,
    actor: SimulationActor,
  ): Promise<RoomMembershipDto[]> {
    const room = await this.requireRoom(roomId);
    assertNotGlobalSimulation(room);
    this.assertOwnerOrAdmin(room, actor, roomId);

    const memberships = await this.deps.memberships.findByRoom(roomId, "pending");
    return memberships.map(toDto);
  }

  /**
   * Approves a pending membership (pending → active).
   * Only the owner or an admin may approve.
   */
  async approve(
    roomId: string,
    membershipId: string,
    actor: SimulationActor,
  ): Promise<RoomMembershipDto> {
    const room = await this.requireRoom(roomId);
    assertNotGlobalSimulation(room);
    this.assertOwnerOrAdmin(room, actor, roomId);

    if (room.status === "archived") {
      throw new RoomArchivedError(roomId);
    }

    const membership = await this.requireMembership(membershipId, roomId);

    if (membership.status !== "pending") {
      throw new InvalidStatusTransitionError(membership.status, "active (approve)");
    }

    const updated = await this.deps.memberships.updateStatus(membershipId, "active");
    if (!updated) throw new MembershipNotFoundError(membershipId);
    return toDto(updated);
  }

  /**
   * Rejects a pending membership request (pending → deleted).
   * Rejected pending rows are deleted entirely — no history is kept (§153).
   */
  async reject(
    roomId: string,
    membershipId: string,
    actor: SimulationActor,
  ): Promise<void> {
    const room = await this.requireRoom(roomId);
    assertNotGlobalSimulation(room);
    this.assertOwnerOrAdmin(room, actor, roomId);

    const membership = await this.requireMembership(membershipId, roomId);

    if (membership.status !== "pending") {
      throw new InvalidStatusTransitionError(membership.status, "deleted (reject)");
    }

    await this.deps.memberships.deleteById(membershipId);
  }

  // -- helpers ---------------------------------------------------------------

  private async requireRoom(id: string) {
    const room = await this.deps.simulations.findById(id);
    if (!room) throw new RoomNotFoundError(id);
    return room;
  }

  private async requireMembership(
    membershipId: string,
    roomId: string,
  ) {
    const membership = await this.deps.memberships.findById(membershipId);
    if (!membership || membership.roomId !== roomId) {
      throw new MembershipNotFoundError(membershipId);
    }
    return membership;
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
