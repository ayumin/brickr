import { DomainError } from "../domain-error.js";
import type { Room } from "./room.js";

/** The Feed room (scope: 'global') cannot be modified, archived, deleted, or joined. */
export class FeedRoomImmutableError extends DomainError {
  readonly httpStatus = 403;
  readonly errorCode = "feed_room_immutable" as const;
  constructor() {
    super("the Feed room cannot be modified or deleted");
  }
}

/**
 * Rejects any mutating operation on the reserved Feed room.
 *
 * The Feed room (scope: 'global') is an internal singleton — its title,
 * lifecycle, and memberships must not be changed through the normal room
 * management API. Shared by `RoomService` and `RoomMembershipService` so the
 * two implementations cannot drift (issue #174).
 *
 * Callers must run their authorization check (`assertOwnerOrAdmin`) BEFORE
 * this guard, not after: a caller with no permission over the room at all
 * should see a generic `RoomForbiddenError`, not `feed_room_immutable` —
 * the latter would reveal that the target id is the reserved Feed room
 * before authorization has even been checked.
 */
export function assertNotFeedRoom(room: Pick<Room, "scope">): void {
  if (room.scope === "global") {
    throw new FeedRoomImmutableError();
  }
}
