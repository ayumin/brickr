/**
 * Room lifecycle service (issue #151, #169, #176).
 *
 * Handles:
 *   - Room creation with automatic owner membership
 *   - Title updates (visibility is immutable after creation)
 *   - Archiving (owner/admin only)
 *   - Deletion of archived rooms (owner/admin only)
 *   - Owner-deactivation archive rule (called by UserAdminService on suspend)
 *   - User join requests (public: auto-join; open: pending(request))
 *   - User invite by handle (owner/admin only; pending(invitation) for closed/private)
 *   - Invitation accept/decline (invitee)
 *   - Request withdrawal (requester)
 *   - Membership approval/rejection (owner/admin only)
 *   - Self-leave (active member → left; owner cannot leave)
 */
import type { PendingInvitationDto, RoomMembershipDto, RoomVisibility } from "@brickr/shared";
import { DomainError } from "../domain-error.js";
import type { RoomRepository } from "./room-repository.js";
import type {
  RoomMembership,
  RoomMembershipRepository,
} from "./room-membership-repository.js";
import { CannotModifyOwnerError } from "./room-membership-errors.js";
import type { HandleRepository } from "../handles/handle-repository.js";
import {
  isRoomOwnerOrAdmin,
  toRoomDto,
  type SignedInActor,
} from "./room-runtime-service.js";
import type { RoomDto } from "@brickr/shared";
import { assertNotFeedRoom } from "./feed-room-guard.js";
import type { UserProfileRepository } from "../user-profile/user-profile-repository.js";
import { RoomNotFoundError } from "./room-errors.js";

// Re-export so existing callers that import from room-service.ts continue to work.
export { RoomNotFoundError } from "./room-errors.js";

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

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

export class InvitationNotFoundError extends DomainError {
  readonly httpStatus = 404;
  readonly errorCode = "invitation_not_found" as const;
  constructor() {
    super("no pending invitation found for this room");
  }
}

export class RequestNotFoundError extends DomainError {
  readonly httpStatus = 404;
  readonly errorCode = "request_not_found" as const;
  constructor() {
    super("no pending join request found for this room");
  }
}

export class CannotLeaveFeedRoomError extends DomainError {
  readonly httpStatus = 403;
  readonly errorCode = "cannot_leave_feed_room" as const;
  constructor() {
    super("cannot leave the Feed room");
  }
}

export class NotAMemberError extends DomainError {
  readonly httpStatus = 409;
  readonly errorCode = "not_a_member" as const;
  constructor(id: string) {
    super(`not an active member of room "${id}"`);
  }
}

export class OwnerCannotLeaveError extends DomainError {
  readonly httpStatus = 403;
  readonly errorCode = "owner_cannot_leave" as const;
  constructor() {
    super("the room owner cannot leave; transfer ownership or archive the room first");
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
  rooms: RoomRepository;
  memberships: RoomMembershipRepository;
  handles?: HandleRepository;
  userProfiles?: UserProfileRepository;
};

export class RoomService {
  constructor(private readonly deps: RoomServiceDeps) {}

  /**
   * Creates a room and grants the creator an active `owner` membership in a
   * single transaction. Visibility defaults to `public` and is fixed at creation.
   */
  async create(input: CreateRoomInput): Promise<RoomDto> {
    const visibility: RoomVisibility = input.visibility ?? "public";
    const room = await this.deps.rooms.createWithOwner(
      input.title ?? null,
      visibility,
      input.createdByUserId,
    );
    return toRoomDto(room);
  }

  /**
   * Updates a room's title. Visibility is immutable — passing it is an error.
   * Only the owner or an admin may update.
   */
  async update(
    id: string,
    input: UpdateRoomInput,
    actor: SignedInActor,
  ): Promise<RoomDto> {
    if (input.visibility !== undefined) {
      throw new VisibilityImmutableError();
    }

    const room = await this.requireRoom(id);
    this.assertOwnerOrAdmin(room, actor, id);
    assertNotFeedRoom(room);

    if (room.status === "archived") {
      throw new RoomArchivedError(id);
    }

    if (input.title !== undefined) {
      const updated = await this.deps.rooms.updateTitle(id, input.title);
      return toRoomDto(updated);
    }

    return toRoomDto(room);
  }

  /**
   * Archives a room. Only the owner or an admin may archive.
   */
  async archive(id: string, actor: SignedInActor): Promise<RoomDto> {
    const room = await this.requireRoom(id);
    this.assertOwnerOrAdmin(room, actor, id);
    assertNotFeedRoom(room);

    const archived = await this.deps.rooms.updateStatus(id, "archived");
    return toRoomDto(archived);
  }

  /**
   * Hard-deletes an archived room. Only the owner or an admin may delete.
   * The room must already be archived — active rooms must be archived first.
   */
  async delete(id: string, actor: SignedInActor): Promise<void> {
    const room = await this.requireRoom(id);
    this.assertOwnerOrAdmin(room, actor, id);
    assertNotFeedRoom(room);

    if (room.status !== "archived") {
      throw new RoomNotArchivedError(id);
    }

    await this.deps.rooms.delete(id);
  }

  /**
   * Archives all active rooms owned by the given user. Called when an owner's
   * account is suspended so their rooms do not remain active without an owner
   * (issue #151 — owner deactivation archive rule).
   */
  async archiveOwnedBy(userId: string): Promise<void> {
    const roomIds = await this.deps.memberships.findActiveOwnerRooms(userId);
    if (roomIds.length === 0) return;
    await this.deps.rooms.archiveByIds(roomIds);
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
   * Requests to join a room (issue #169, #176).
   *
   * - public rooms: auto-join (active membership immediately)
   * - open rooms: pending(request) membership (owner approval required)
   * - closed/private rooms: invitation only — self-initiated join is rejected
   *
   * Banned members are always rejected. Already-active members get a 409.
   * Pending members (already requested) also get a 409.
   */
  async join(roomId: string, actor: SignedInActor): Promise<RoomMembershipDto> {
    const room = await this.requireRoom(roomId);
    assertNotFeedRoom(room);

    if (room.status === "archived") {
      throw new RoomArchivedError(roomId);
    }

    // closed/private: invitation only
    if (room.visibility === "closed" || room.visibility === "private") {
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
      const status = room.visibility === "public" ? "active" : "pending";
      const updated = status === "pending"
        ? await this.deps.memberships.updateStatusByMember(
            roomId,
            "user",
            actor.id,
            status,
            "request",
          )
        : await this.deps.memberships.updateStatusByMember(
            roomId,
            "user",
            actor.id,
            status,
          );
      if (!updated) throw new RoomNotFoundError(roomId);
      return toMembershipDto(updated);
    }

    // No existing membership: create one
    const isPublic = room.visibility === "public";
    const status = isPublic ? "active" : "pending";
    const membership = await this.deps.memberships.create({
      roomId,
      memberKind: "user",
      memberId: actor.id,
      role: "member",
      status,
      // For open rooms, record that this is a self-initiated request.
      ...(isPublic ? {} : { origin: "request" as const }),
    });
    return toMembershipDto(membership);
  }

  /**
   * Invites a user (by handle) to a room (issue #169, #176).
   *
   * Only the room owner or an admin may invite.
   * - public/open rooms: active membership immediately (owner bypasses the pending flow).
   * - closed/private rooms: pending(invitation) membership — the invitee must accept.
   *
   * If the user already has a pending(request) membership, the owner's invite
   * upgrades it to active immediately (owner approval on behalf of the invitee).
   */
  async inviteByHandle(
    roomId: string,
    handle: string,
    actor: SignedInActor,
  ): Promise<RoomMembershipDto> {
    const room = await this.requireRoom(roomId);
    this.assertOwnerOrAdmin(room, actor, roomId);
    assertNotFeedRoom(room);

    if (room.status === "archived") {
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
      // pending/left/removed: upgrade to active (owner approval)
      const updated = await this.deps.memberships.reinviteByMember(
        roomId,
        "user",
        userId,
        actor.id,
      );
      if (!updated) throw new RoomNotFoundError(roomId);
      return toMembershipDto(updated);
    }

    // For closed/private rooms, create a pending(invitation) membership.
    // For public/open rooms, create an active membership immediately.
    const needsPendingInvitation =
      room.visibility === "closed" || room.visibility === "private";

    const membership = await this.deps.memberships.create({
      roomId,
      memberKind: "user",
      memberId: userId,
      role: "member",
      status: needsPendingInvitation ? "pending" : "active",
      ...(needsPendingInvitation ? { origin: "invitation" as const } : {}),
      invitedById: actor.id,
    });
    return toMembershipDto(membership);
  }

  /**
   * Accepts a pending invitation (invitee only, issue #176).
   *
   * The caller must have a pending(invitation) membership in the room.
   * Transitions the membership to active.
   */
  async acceptInvitation(roomId: string, actor: SignedInActor): Promise<RoomMembershipDto> {
    const room = await this.requireRoom(roomId);
    assertNotFeedRoom(room);

    if (room.status === "archived") {
      throw new RoomArchivedError(roomId);
    }

    const membership = await this.deps.memberships.findOne(roomId, "user", actor.id);
    if (
      !membership ||
      membership.status !== "pending" ||
      membership.origin !== "invitation"
    ) {
      throw new InvitationNotFoundError();
    }

    const updated = await this.deps.memberships.updateStatusByMember(
      roomId,
      "user",
      actor.id,
      "active",
    );
    if (!updated) throw new RoomMembershipNotFoundError();
    return toMembershipDto(updated);
  }

  /**
   * Declines a pending invitation (invitee only, issue #176).
   *
   * The caller must have a pending(invitation) membership in the room.
   * Deletes the membership row — no history is kept.
   */
  async declineInvitation(roomId: string, actor: SignedInActor): Promise<void> {
    const room = await this.requireRoom(roomId);
    assertNotFeedRoom(room);

    const membership = await this.deps.memberships.findOne(roomId, "user", actor.id);
    if (
      !membership ||
      membership.status !== "pending" ||
      membership.origin !== "invitation"
    ) {
      throw new InvitationNotFoundError();
    }

    await this.deps.memberships.deleteById(membership.id);
  }

  /**
   * Withdraws a pending join request (requester only, issue #176).
   *
   * The caller must have a pending(request) membership in the room.
   * Deletes the membership row — the user may re-request immediately.
   */
  async withdrawRequest(roomId: string, actor: SignedInActor): Promise<void> {
    const room = await this.requireRoom(roomId);
    assertNotFeedRoom(room);

    const membership = await this.deps.memberships.findOne(roomId, "user", actor.id);
    if (
      !membership ||
      membership.status !== "pending" ||
      membership.origin !== "request"
    ) {
      throw new RequestNotFoundError();
    }

    await this.deps.memberships.deleteById(membership.id);
  }

  /**
   * Returns the caller's pending invitation for a room (issue #178).
   *
   * The caller must have a pending(invitation) membership in the room.
   * Returns enough context for the invitee to decide whether to accept or decline.
   */
  async getInvitation(roomId: string, actor: SignedInActor): Promise<PendingInvitationDto> {
    const room = await this.requireRoom(roomId);
    assertNotFeedRoom(room);

    const membership = await this.deps.memberships.findOne(roomId, "user", actor.id);
    if (
      !membership ||
      membership.status !== "pending" ||
      membership.origin !== "invitation"
    ) {
      throw new InvitationNotFoundError();
    }

    // Count active members
    const allMemberships = await this.deps.memberships.findByRoom(roomId, "active");
    const activeMemberCount = allMemberships.length;

    // Look up the room owner's profile for display
    let ownerHandle = "unknown";
    let ownerDisplayName = "不明";
    if (room.createdByUserId && this.deps.userProfiles) {
      const ownerProfile = await this.deps.userProfiles.findById(room.createdByUserId);
      if (ownerProfile) {
        ownerHandle = ownerProfile.handle;
        ownerDisplayName = ownerProfile.displayName;
      }
    }

    return {
      roomId: room.id,
      roomTitle: room.title,
      roomVisibility: room.visibility,
      ownerHandle,
      ownerDisplayName,
      activeMemberCount,
      invitedAt: (membership.invitedAt ?? membership.createdAt).toISOString(),
    };
  }

  /**
   * Leaves a room (active member only, issue #176).
   *
   * - Feed rooms cannot be left.
   * - The room owner cannot leave (must archive or transfer ownership first).
   * - Transitions the membership from active → left.
   */
  async leave(roomId: string, actor: SignedInActor): Promise<void> {
    const room = await this.requireRoom(roomId);

    // Feed rooms are implicitly joined and cannot be left.
    if (room.scope === "global") {
      throw new CannotLeaveFeedRoomError();
    }

    const membership = await this.deps.memberships.findOne(roomId, "user", actor.id);
    if (!membership || membership.status !== "active") {
      throw new NotAMemberError(roomId);
    }

    if (membership.role === "owner") {
      throw new OwnerCannotLeaveError();
    }

    const updated = await this.deps.memberships.updateStatusByMember(
      roomId,
      "user",
      actor.id,
      "left",
    );
    if (!updated) throw new RoomMembershipNotFoundError();
  }

  /**
   * Approves a pending membership (owner/admin only, issue #169).
   */
  async approveMembership(
    roomId: string,
    memberId: string,
    actor: SignedInActor,
  ): Promise<RoomMembershipDto> {
    const room = await this.requireRoom(roomId);
    this.assertOwnerOrAdmin(room, actor, roomId);
    assertNotFeedRoom(room);

    if (room.status === "archived") {
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
    actor: SignedInActor,
  ): Promise<void> {
    const room = await this.requireRoom(roomId);
    this.assertOwnerOrAdmin(room, actor, roomId);
    assertNotFeedRoom(room);

    if (room.status === "archived") {
      throw new RoomArchivedError(roomId);
    }
    this.assertNotOwnerMembership(room, memberId);

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
    actor: SignedInActor,
  ): Promise<void> {
    const room = await this.requireRoom(roomId);
    this.assertOwnerOrAdmin(room, actor, roomId);
    assertNotFeedRoom(room);

    if (room.status === "archived") {
      throw new RoomArchivedError(roomId);
    }
    this.assertNotOwnerMembership(room, memberId);

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
    const room = await this.deps.rooms.findById(id);
    if (!room) throw new RoomNotFoundError(id);
    return room;
  }

  private assertOwnerOrAdmin(
    room: { createdByUserId?: string },
    actor: SignedInActor,
    id: string,
  ): void {
    if (!isRoomOwnerOrAdmin(room, actor)) {
      throw new RoomForbiddenError(id);
    }
  }

  private assertNotOwnerMembership(
    room: { createdByUserId?: string },
    memberId: string,
  ): void {
    if (memberId === room.createdByUserId) {
      throw new CannotModifyOwnerError();
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
    ...(m.origin ? { origin: m.origin } : {}),
    ...(m.invitedById ? { invitedById: m.invitedById } : {}),
    ...(m.invitedAt ? { invitedAt: m.invitedAt.toISOString() } : {}),
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}
