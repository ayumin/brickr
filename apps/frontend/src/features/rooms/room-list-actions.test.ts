import { describe, expect, it } from "vitest";
import type { RoomListEntryDto } from "@brickr/shared";
import { canJoinRoom } from "./room-list-actions";

function room(overrides: Partial<Extract<RoomListEntryDto, { restricted: false }>> = {}) {
  return {
    restricted: false,
    id: "room-1",
    title: "テストルーム",
    status: "active",
    visibility: "public",
    createdAt: "2026-08-17T00:00:00.000Z",
    postCount: 0,
    lastActivityAt: "2026-08-17T00:00:00.000Z",
    creator: null,
    canManage: false,
    isMember: false,
    ...overrides,
  } satisfies Extract<RoomListEntryDto, { restricted: false }>;
}

describe("canJoinRoom", () => {
  it("allows non-members to join active public and open rooms", () => {
    expect(canJoinRoom(room({ visibility: "public" }))).toBe(true);
    expect(canJoinRoom(room({ visibility: "open" }))).toBe(true);
  });

  it("does not offer join to an existing active member", () => {
    expect(canJoinRoom(room({ isMember: true }))).toBe(false);
  });

  it("does not offer join to managers, archived rooms, or invite-only rooms", () => {
    expect(canJoinRoom(room({ canManage: true }))).toBe(false);
    expect(canJoinRoom(room({ status: "archived" }))).toBe(false);
    expect(canJoinRoom(room({ visibility: "closed" }))).toBe(false);
    expect(canJoinRoom(room({ visibility: "private" }))).toBe(false);
  });
});
