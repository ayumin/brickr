import type { PostDto } from "./post.js";

export const ROOM_STATUSES = ["active", "archived"] as const;

export type RoomStatus = (typeof ROOM_STATUSES)[number];

/** Visibility of a room to non-members. */
export const ROOM_VISIBILITIES = ["public", "open", "closed", "private"] as const;

export type RoomVisibility = (typeof ROOM_VISIBILITIES)[number];

/** Lifecycle state of a room membership. */
export const MEMBERSHIP_STATUSES = ["active", "pending", "left", "removed", "banned"] as const;

export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/** Origin of a pending membership: self-initiated request or owner-initiated invitation. */
export const MEMBERSHIP_ORIGINS = ["request", "invitation"] as const;

export type MembershipOrigin = (typeof MEMBERSHIP_ORIGINS)[number];

/** Polymorphic member kind: distinguishes a real user from an AI character. */
export const MEMBER_KINDS = ["user", "character"] as const;

export type MemberKind = (typeof MEMBER_KINDS)[number];

/** Role within a room. Only users may be owners; characters are always members. */
export const MEMBER_ROLES = ["owner", "member"] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

/**
 * An always-seeded public room: the unified feed's embedded composer targets
 * it directly so a new top-level post never requires the poster to pick a
 * room first. It remains a real Room for persistence and feed aggregation,
 * but is intentionally omitted from the user-facing Room list.
 */
export const DEFAULT_ROOM_ID = "20000000-0000-4000-8000-000000000001";
export const DEFAULT_ROOM_TITLE = "フィード";

export type RoomDto = {
  id: string;
  title: string | null;
  status: RoomStatus;
  visibility: RoomVisibility;
  createdAt: string;
  /** Public to everyone, unlike Character ownership (§66.6). Absent for pre-login rooms. */
  createdByUserId?: string;
};

/**
 * Server-computed capabilities for the current user in a room (issue #178).
 *
 * The server is the single source of truth for these — the client must not
 * re-derive them from visibility/membership state, since that is how the two
 * sides drift apart.
 */
export type RoomCapabilitiesDto = {
  /** Whether the actor may read the room's posts and full metadata. */
  canView: boolean;
  /** Whether the actor may create posts in the room. */
  canPost: boolean;
  /** Whether the actor may request to join (or auto-join) the room. */
  canJoin: boolean;
  /** Whether the actor may leave the room (active member, not the owner). */
  canLeave: boolean;
  /** Whether the actor may invite others to the room. */
  canInvite: boolean;
  /** Whether the actor may rename/stop/resume/analyse the room. */
  canManage: boolean;
};

/**
 * Who created a room, as the room list shows it (§10.3).
 *
 * Room ownership is public, unlike a character's (§66.6), so this travels with
 * every entry. It is a public account shape rather than a raw id because an id
 * says nothing to a reader — and `null` means the room has no owner at all.
 */
export type RoomCreatorDto = {
  id: string;
  handle: string;
  displayName: string;
};

export type RoomSummaryDto = RoomDto & {
  postCount: number;
  /** Newest activity anywhere in the room. The room list orders by it (§10.3). */
  lastActivityAt: string;
  creator: RoomCreatorDto | null;
  /**
   * Rename/stop/resume/analysis, decided by the server (§10.3).
   *
   * The client must not re-derive this from `createdByUserId` and the session:
   * duplicating the rule in the frontend is how the two drift apart, and the
   * server is the only side that can enforce it anyway.
   */
  canManage: boolean;
  /**
   * Number of pending join requests. Only present for the room owner, so they
   * can show a badge on the room entry in the list (issue #155).
   * Absent for non-owners.
   */
  pendingCount?: number;
  /**
   * Server-computed capabilities for the current user (issue #178).
   *
   * Present on the room detail endpoint (`GET /api/rooms/:id`). The client
   * must not re-derive these from visibility/membership state.
   */
  capabilities?: RoomCapabilitiesDto;
};

/**
 * One entry in the visibility-aware room list (issue #155).
 *
 * For `closed` rooms where the caller is not an active member, only the
 * prescribed metadata fields are present (id, title, visibility, createdAt).
 * Full metadata is available for public/open rooms and for members of
 * closed/private rooms.
 */
export type RoomListEntryDto =
  | (RoomSummaryDto & {
      restricted: false;
      /** Whether the caller currently holds an active membership in this room. */
      isMember: boolean;
    })
  | {
      /** Restricted entry: only prescribed metadata for closed non-members. */
      restricted: true;
      id: string;
      title: string | null;
      visibility: RoomVisibility;
      createdAt: string;
    };

export type RoomListResponse = {
  rooms: RoomListEntryDto[];
};

export type CreateRoomRequest = {
  title?: string;
  /** Visibility of the room. Defaults to `public` if omitted. Immutable after creation. */
  visibility?: RoomVisibility;
};

/**
 * A pending invitation as seen by the invitee (issue #178).
 *
 * Returned by `GET /api/rooms/:id/invitation` so the invitee can see
 * enough context to decide whether to accept or decline.
 */
export type PendingInvitationDto = {
  roomId: string;
  roomTitle: string | null;
  roomVisibility: RoomVisibility;
  ownerHandle: string;
  ownerDisplayName: string;
  activeMemberCount: number;
  invitedAt: string;
};

export type CreateRoomResponse = {
  room: RoomDto;
};

export type UpdateRoomRequest = {
  title: string;
};

export type RoomPostRankingDto = {
  postId: string;
  content: string;
  author: PostDto["author"];
  replyCount: number;
  repostCount: number;
  score: number;
  createdAt: string;
};

export type RoomAuthorRankingDto = {
  author: PostDto["author"];
  postCount: number;
  replyCount: number;
  repostCount: number;
  receivedReactionCount: number;
};

export type RoomContentSummaryDto = {
  overallTopics: string;
  postOverview: string;
  highEngagementTopics: string;
  lowEngagementTopics: string;
};

export type RoomAnalysisDto = {
  room: RoomDto;
  summary: RoomContentSummaryDto;
  postCount: number;
  authorCount: number;
  replyCount: number;
  repostCount: number;
  ranking: RoomPostRankingDto[];
  authorRanking: RoomAuthorRankingDto[];
};

export type RoomAnalysisResponse = {
  analysis: RoomAnalysisDto;
};

/**
 * One room's basics, without its posts (§10.4).
 *
 * The posts used to ride along here, which meant opening a room downloaded its
 * entire history. Reading a room is the feed's job now
 * (`GET /api/rooms/:id/feed`), which pages instead.
 *
 * Summary-shaped (postCount/creator/canManage), same as the list endpoint's
 * entries: the room info panel (§19.2) needs exactly these fields for one
 * room, and duplicating the room list's summary type for a single-room
 * variant would just be the same fields under a different name.
 */
export type RoomResponse = {
  room: RoomSummaryDto;
};

// ---------------------------------------------------------------------------
// Room analysis snapshot (issue #166)
// ---------------------------------------------------------------------------

/** Lifecycle status of a room analysis snapshot. */
export const SNAPSHOT_STATUSES = ["pending", "completed", "failed"] as const;

export type SnapshotStatus = (typeof SNAPSHOT_STATUSES)[number];

/**
 * A room analysis snapshot as returned by the API.
 *
 * Contains the LLM-generated summary and post statistics for a room.
 * Only one snapshot is kept per room (the latest).
 *
 * When `status` is `"failed"`, `lastSuccessful` may be present and contains
 * the most recent successfully completed snapshot so the caller can still
 * display useful data.
 */
export type RoomAnalysisSnapshotDto = {
  id: string;
  roomId: string;
  postCount: number;
  latestPostId: string | null;
  summary: string | null;
  status: SnapshotStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present when status is "failed" and a prior successful snapshot exists. */
  lastSuccessful?: RoomAnalysisSnapshotDto;
};

export type RoomAnalysisSnapshotResponse = {
  snapshot: RoomAnalysisSnapshotDto;
};

export type UpdateRoomAnalysisSnapshotResponse = {
  snapshot: RoomAnalysisSnapshotDto;
  /** True when the snapshot was regenerated; false when no change was detected. */
  updated: boolean;
};

/** A room membership record as returned by the API. */
export type RoomMembershipDto = {
  id: string;
  roomId: string;
  memberKind: MemberKind;
  memberId: string;
  role: MemberRole;
  status: MembershipStatus;
  /** Present when status is pending: distinguishes a self-initiated request from an owner invitation. */
  origin?: MembershipOrigin;
  invitedById?: string;
  invitedAt?: string;
  createdAt: string;
  updatedAt: string;
};
