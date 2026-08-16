import type { PostDto } from "./post.js";

export const ROOM_STATUSES = ["active", "archived"] as const;

export type RoomStatus = (typeof ROOM_STATUSES)[number];

/**
 * Internal only: `scope` never reaches a screen as a label (§8.1). The reserved
 * global room is shown as "フィード", ordinary ones as rooms.
 */
export const ROOM_SCOPES = ["global", "room"] as const;

export type RoomScope = (typeof ROOM_SCOPES)[number];

/**
 * The one room the unified feed posts into (§8.2).
 *
 * A real row with a fixed id, rather than `roomId = null`, so the existing
 * foreign key, posting API and permission checks keep working unchanged. It is
 * seeded, never created through the API, and rejects rename/stop/resume/delete.
 */
export const GLOBAL_ROOM_ID = "00000000-0000-4000-8000-000000000001";

/** Title seeded for the global room, and what the feed is called on screen. */
export const GLOBAL_ROOM_TITLE = "フィード";

/** Visibility of a room to non-members. */
export const ROOM_VISIBILITIES = ["public", "open", "closed", "private"] as const;

export type RoomVisibility = (typeof ROOM_VISIBILITIES)[number];

/** Lifecycle state of a room membership. */
export const MEMBERSHIP_STATUSES = ["active", "pending", "left", "removed", "banned"] as const;

export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/** Polymorphic member kind: distinguishes a real user from an AI character. */
export const MEMBER_KINDS = ["user", "character"] as const;

export type MemberKind = (typeof MEMBER_KINDS)[number];

/** Role within a room. Only users may be owners; characters are always members. */
export const MEMBER_ROLES = ["owner", "member"] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

export type RoomDto = {
  id: string;
  title: string | null;
  status: RoomStatus;
  createdAt: string;
  /** Public to everyone, unlike Character ownership (§66.6). Absent for pre-login rooms. */
  createdByUserId?: string;
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
};

export type RoomsResponse = {
  simulations: RoomSummaryDto[];
};

export type CreateRoomRequest = {
  title?: string;
};

export type CreateRoomResponse = {
  simulation: RoomDto;
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
  simulation: RoomDto;
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
 * (`GET /api/simulations/:id/feed`), which pages instead.
 *
 * Summary-shaped (postCount/creator/canManage), same as the list endpoint's
 * entries: the room info panel (§19.2) needs exactly these fields for one
 * room, and duplicating the room list's summary type for a single-room
 * variant would just be the same fields under a different name.
 */
export type RoomResponse = {
  simulation: RoomSummaryDto;
};

/** A room membership record as returned by the API. */
export type RoomMembershipDto = {
  id: string;
  roomId: string;
  memberKind: MemberKind;
  memberId: string;
  role: MemberRole;
  status: MembershipStatus;
  invitedById?: string;
  invitedAt?: string;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Backward-compatible aliases so existing consumers can migrate incrementally.
// These will be removed once all callers have been updated.
// ---------------------------------------------------------------------------

/** @deprecated Use `RoomStatus` instead. */
export type SimulationStatus = RoomStatus;

/** @deprecated Use `RoomScope` instead. */
export type SimulationScope = RoomScope;

/** @deprecated Use `GLOBAL_ROOM_ID` instead. */
export const GLOBAL_SIMULATION_ID = GLOBAL_ROOM_ID;

/** @deprecated Use `GLOBAL_ROOM_TITLE` instead. */
export const GLOBAL_SIMULATION_TITLE = GLOBAL_ROOM_TITLE;

/** @deprecated Use `RoomDto` instead. */
export type SimulationDto = RoomDto;

/** @deprecated Use `RoomCreatorDto` instead. */
export type SimulationCreatorDto = RoomCreatorDto;

/** @deprecated Use `RoomSummaryDto` instead. */
export type SimulationSummaryDto = RoomSummaryDto;

/** @deprecated Use `RoomsResponse` instead. */
export type SimulationsResponse = RoomsResponse;

/** @deprecated Use `CreateRoomRequest` instead. */
export type CreateSimulationRequest = CreateRoomRequest;

/** @deprecated Use `CreateRoomResponse` instead. */
export type CreateSimulationResponse = CreateRoomResponse;

/** @deprecated Use `UpdateRoomRequest` instead. */
export type UpdateSimulationRequest = UpdateRoomRequest;

/** @deprecated Use `RoomPostRankingDto` instead. */
export type SimulationPostRankingDto = RoomPostRankingDto;

/** @deprecated Use `RoomAuthorRankingDto` instead. */
export type SimulationAuthorRankingDto = RoomAuthorRankingDto;

/** @deprecated Use `RoomContentSummaryDto` instead. */
export type SimulationContentSummaryDto = RoomContentSummaryDto;

/** @deprecated Use `RoomAnalysisDto` instead. */
export type SimulationAnalysisDto = RoomAnalysisDto;

/** @deprecated Use `RoomAnalysisResponse` instead. */
export type SimulationAnalysisResponse = RoomAnalysisResponse;

/** @deprecated Use `RoomResponse` instead. */
export type SimulationResponse = RoomResponse;

/** @deprecated Use `ROOM_STATUSES` instead. */
export const SIMULATION_STATUSES = ROOM_STATUSES;

/** @deprecated Use `ROOM_SCOPES` instead. */
export const SIMULATION_SCOPES = ROOM_SCOPES;
