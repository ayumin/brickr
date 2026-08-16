import type { RoomListEntryDto } from "@brickr/shared";

type FullRoomEntry = Extract<RoomListEntryDto, { restricted: false }>;

/** Whether the room list should offer a self-service join action. */
export function canJoinRoom(entry: FullRoomEntry): boolean {
  return (
    !entry.canManage &&
    !entry.isMember &&
    entry.status === "active" &&
    (entry.visibility === "public" || entry.visibility === "open")
  );
}
