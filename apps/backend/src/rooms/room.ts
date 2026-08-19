import type { RoomVisibility, RoomStatus } from "@brickr/shared";
import type { UserAccount } from "../auth/user-account.js";

/**
 * The signed-in caller, reduced to what an ownership check needs (CLAUDE.md §66.6).
 *
 * Defined with the domain model rather than with the service, because the
 * repository needs it too: which rooms exist *for this caller* is part of the
 * query (§10.3), and a repository must not import from a service.
 */
export type SignedInActor = Pick<UserAccount, "id" | "isAdmin">;

/** Internal room scope: distinguishes the Feed room from user-created rooms. */
export type RoomScope = "global" | "room";

export type Room = {
  id: string;
  title: string | null;
  status: RoomStatus;
  visibility: RoomVisibility;
  /**
   * Internal scope: 'global' for the reserved Feed room, 'room' for all
   * user-created rooms. Not exposed in public DTOs.
   */
  scope: RoomScope;
  /** Free-form discovery tags used to match autonomous Cast interests. */
  tags: string[];
  createdAt: Date;
  /** Newest activity anywhere in the room, used to order rooms (§8.1). */
  lastActivityAt: Date;
  /** Public to everyone (CLAUDE.md §66.6). Absent for rooms created before login existed. */
  createdByUserId?: string;
};

/** Public identity of a room's creator, for the room list (§10.3). */
export type RoomCreator = {
  id: string;
  handle: string;
  displayName: string;
};

export type RoomSummary = Room & {
  postCount: number;
  /** `null` when the room has no owner — a room created before login existed. */
  creator: RoomCreator | null;
  /**
   * Number of pending join requests. Only populated for the room list when the
   * caller is the room owner, so they can show a badge on the room entry.
   * Absent for non-owners and for the single-room summary endpoint.
   */
  pendingCount?: number;
  /**
   * Whether the caller holds an active membership in this room.
   * Only populated for the room list query; used to apply metadata restrictions
   * for closed rooms (issue #155). Absent for the single-room summary endpoint.
   */
  callerIsActiveMember?: boolean;
};

/** The two post shapes a character can produce. Plain `post` is a standalone comment. */
export const RESPONSE_ACTIONS = ["reply", "quote", "post"] as const;

export type ResponseAction = (typeof RESPONSE_ACTIONS)[number];
