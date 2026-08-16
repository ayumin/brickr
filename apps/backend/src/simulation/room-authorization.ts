/**
 * Room visibility × membership × actor authorization (issue #152).
 *
 * This module centralises every "can this actor do X in this room?" decision.
 * All callers — routes, services, feed — must go through these functions rather
 * than re-implementing the rules locally, so a change to the matrix propagates
 * everywhere at once.
 *
 * Authorization matrix (visibility × membership status × actor kind):
 *
 * | Action      | public | open | closed | private |
 * |-------------|--------|------|--------|---------|
 * | canDiscover | all    | all  | member | member  |
 * | canView     | all    | all  | member | member  |
 * | canPost     | user*  | user*| member | member  |
 * | canJoin     | user   | user†| invite | invite  |
 * | canInvite   | owner  | owner| owner  | owner   |
 * | canManage   | owner/admin | owner/admin | owner/admin | owner/admin |
 *
 * *  Active membership required for closed/private; for public/open any
 *    authenticated user who is not banned may post (they auto-join on first post).
 * †  open rooms require approval (pending → active), so canJoin is true but
 *    the resulting membership starts as "pending".
 *
 * "member" in the table means: memberKind=user|character with status=active.
 * "owner"  means: memberKind=user with role=owner and status=active.
 * "admin"  means: actor.isAdmin === true (bypasses all membership checks).
 *
 * Metadata restriction for closed rooms (non-members):
 *   canDiscover controls whether the title may be exposed in discovery.
 *   canViewMetadata covers the room's full metadata and currently follows
 *   canView, so non-members of closed/private rooms receive neither.
 */

import type { MemberKind, MemberRole, MembershipStatus, RoomVisibility } from "@brickr/shared";

// ---------------------------------------------------------------------------
// Actor types
// ---------------------------------------------------------------------------

/**
 * The caller reduced to what an authorization check needs.
 *
 * Three shapes:
 *   - anonymous: no session (public read only)
 *   - user:      signed-in human, with optional membership in the target room
 *   - character: AI character, with optional membership in the target room
 *
 * `isAdmin` is only meaningful on the `user` shape; characters are never admins.
 */
export type RoomActor =
  | { kind: "anonymous" }
  | {
      kind: "user";
      userId: string;
      isAdmin: boolean;
      membership?: RoomMembershipSnapshot;
    }
  | {
      kind: "character";
      characterId: string;
      membership?: RoomMembershipSnapshot;
    };

/**
 * The subset of a RoomMembership row that authorization needs.
 *
 * Kept narrow so callers can construct it from any source (DB row, DTO, fake)
 * without pulling in the full Prisma model.
 */
export type RoomMembershipSnapshot = {
  memberKind: MemberKind;
  role: MemberRole;
  status: MembershipStatus;
};

// ---------------------------------------------------------------------------
// Room shape
// ---------------------------------------------------------------------------

/**
 * The subset of a Room that authorization needs.
 */
export type RoomForAuth = {
  visibility: RoomVisibility;
  /** "active" | "archived" */
  status: string;
  createdByUserId?: string | null;
};

// ---------------------------------------------------------------------------
// Authorization results
// ---------------------------------------------------------------------------

export type RoomCapabilities = {
  /** Whether the room appears in discovery / search results. */
  canDiscover: boolean;
  /** Whether the actor may read the room's posts and full metadata. */
  canView: boolean;
  /** Whether the actor may read the room's full metadata. */
  canViewMetadata: boolean;
  /** Whether the actor may create posts in the room. */
  canPost: boolean;
  /** Whether the actor may request to join (or auto-join) the room. */
  canJoin: boolean;
  /** Whether the actor may invite others to the room. */
  canInvite: boolean;
  /** Whether the actor may rename/stop/resume/analyse the room. */
  canManage: boolean;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function activeMembership(actor: RoomActor): RoomMembershipSnapshot | undefined {
  if (actor.kind === "anonymous") return undefined;
  const m = actor.membership;
  return m?.status === "active" ? m : undefined;
}

/** Any membership row exists (active, pending, left, removed, banned). */
function anyMembership(actor: RoomActor): RoomMembershipSnapshot | undefined {
  if (actor.kind === "anonymous") return undefined;
  return actor.membership;
}

function isOwner(actor: RoomActor): boolean {
  if (actor.kind !== "user") return false;
  const m = activeMembership(actor);
  return m?.role === "owner" && m.memberKind === "user";
}

function isAdmin(actor: RoomActor): boolean {
  return actor.kind === "user" && actor.isAdmin;
}

function isActiveMember(actor: RoomActor): boolean {
  return activeMembership(actor) !== undefined;
}

function isAuthenticated(actor: RoomActor): boolean {
  return actor.kind !== "anonymous";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the full capability set for one actor against one room.
 *
 * This is the single source of truth for all room authorization decisions.
 * Call it once per request and pass the result down rather than calling
 * individual helpers multiple times.
 */
export function computeRoomCapabilities(
  room: RoomForAuth,
  actor: RoomActor,
): RoomCapabilities {
  const admin = isAdmin(actor);
  const owner = isOwner(actor);
  const member = isActiveMember(actor);
  const authed = isAuthenticated(actor);
  const banned = anyMembership(actor)?.status === "banned";
  const archived = room.status === "archived";

  // Admins bypass all membership checks, but archived rooms still restrict
  // posting for everyone (including admins) — you cannot post into a stopped room.
  if (admin) {
    const adminHasActiveMembership = isActiveMember(actor);
    const adminHasPendingMembership = anyMembership(actor)?.status === "pending";
    return {
      canDiscover: true,
      canView: true,
      canViewMetadata: true,
      canPost: !archived,
      canJoin: !adminHasActiveMembership && !adminHasPendingMembership && !archived,
      canInvite: !archived,
      canManage: true,
    };
  }

  const { visibility } = room;

  // canDiscover / canView: who can see the room at all?
  //   public / open  → everyone (active) or owner/admin (archived)
  //   closed / private → active members only (active) or owner/admin (archived)
  //
  // Archived rooms are only accessible to their owner or an administrator,
  // regardless of visibility. This preserves the existing behaviour (§10.4):
  // a stopped room "does not exist" for anyone else, so they cannot discover
  // it or read its posts through the room-scoped endpoints.
  const visibleToAll = visibility === "public" || visibility === "open";
  const baseVisible = visibleToAll || member;

  // For archived rooms, only the owner can view (admin is handled above).
  const canDiscover = archived ? isOwner(actor) : baseVisible;
  const canView = archived ? isOwner(actor) : baseVisible;

  // canViewMetadata: title is always visible when canDiscover is true;
  // description/tags are restricted for non-members of closed/private rooms.
  const canViewMetadata = canView;

  // canPost: authenticated + active member for closed/private;
  //          any authenticated user for public/open (they auto-join on first post).
  //          Archived rooms block posting for everyone.
  let canPost: boolean;
  if (archived) {
    canPost = false;
  } else if (visibility === "public" || visibility === "open") {
    canPost = authed && !banned;
  } else {
    // closed / private: must be an active member
    canPost = member;
  }

  // canJoin: can the actor request or auto-join?
  //   public  → any authenticated actor with no existing membership row (auto-join)
  //   open    → any authenticated actor with no existing membership row (pending → active after approval)
  //   closed  → only via invitation (canJoin = false for self-initiated)
  //   private → only via invitation (canJoin = false for self-initiated)
  //   Archived rooms: no new joins.
  //
  // "No existing membership row" means no row at all — a pending membership
  // means the actor has already requested to join and must not submit again.
  // left/removed actors may re-join public/open rooms (the service
  // layer decides whether to create a new row or update the existing one).
  const hasActiveMembership = member;

  let canJoin: boolean;
  if (archived || hasActiveMembership) {
    // Already active or room is archived: no join needed / allowed.
    canJoin = false;
  } else if (visibility === "public" || visibility === "open") {
    // Public/open: any authenticated actor without a pending membership can join.
    // left/removed may re-join; pending must wait and banned actors stay excluded.
    const hasPendingMembership =
      anyMembership(actor)?.status === "pending";
    canJoin = authed && !hasPendingMembership && !banned;
  } else {
    // closed/private: invitation only, no self-initiated join.
    canJoin = false;
  }

  // canInvite: only the room owner (or admin, handled above).
  const canInvite = owner && !archived;

  // canManage: rename/stop/resume/analyse — owner or admin only.
  const canManage = owner;

  return {
    canDiscover,
    canView,
    canViewMetadata,
    canPost,
    canJoin,
    canInvite,
    canManage,
  };
}

/**
 * Convenience: can this actor discover the room?
 *
 * Prefer `computeRoomCapabilities` when you need more than one capability.
 */
export function canDiscover(room: RoomForAuth, actor: RoomActor): boolean {
  return computeRoomCapabilities(room, actor).canDiscover;
}

/**
 * Convenience: can this actor view the room's posts and full metadata?
 */
export function canView(room: RoomForAuth, actor: RoomActor): boolean {
  return computeRoomCapabilities(room, actor).canView;
}

/**
 * Convenience: can this actor post into the room?
 */
export function canPost(room: RoomForAuth, actor: RoomActor): boolean {
  return computeRoomCapabilities(room, actor).canPost;
}

/**
 * Convenience: can this actor join the room?
 */
export function canJoin(room: RoomForAuth, actor: RoomActor): boolean {
  return computeRoomCapabilities(room, actor).canJoin;
}

/**
 * Convenience: can this actor invite others to the room?
 */
export function canInvite(room: RoomForAuth, actor: RoomActor): boolean {
  return computeRoomCapabilities(room, actor).canInvite;
}

/**
 * Convenience: can this actor manage (rename/stop/resume/analyse) the room?
 */
export function canManage(room: RoomForAuth, actor: RoomActor): boolean {
  return computeRoomCapabilities(room, actor).canManage;
}
