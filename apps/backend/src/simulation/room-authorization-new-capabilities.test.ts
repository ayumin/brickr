/**
 * Coverage for the two capabilities added in issue #175:
 *   - canLeave: an active, non-owner member may leave the room.
 *   - Feed room (scope: 'global'): no membership rows exist, so only canPost
 *     is meaningful — every other capability is false for everyone, admins
 *     included (issue #174's Feed-room-is-immutable rule extended here).
 *
 * Kept separate from the existing `room-authorization(-matrix).test.ts` tables
 * rather than adding two more columns to every one of their ~90 rows: those
 * tables already pin down the seven original capabilities exhaustively, and
 * retrofitting them risked a typo in an unrelated row for little benefit.
 */
import { describe, expect, it } from "vitest";
import {
  computeRoomCapabilities,
  canLeave,
  type RoomActor,
  type RoomForAuth,
} from "./room-authorization.js";
import type { MemberRole, MembershipStatus, RoomVisibility } from "@brickr/shared";

const anon: RoomActor = { kind: "anonymous" };

function user(opts: { isAdmin?: boolean; status?: MembershipStatus; role?: MemberRole } = {}): RoomActor {
  const { isAdmin = false, status, role = "member" } = opts;
  if (status === undefined) return { kind: "user", userId: "u1", isAdmin };
  return { kind: "user", userId: "u1", isAdmin, membership: { memberKind: "user", role, status } };
}

function room(visibility: RoomVisibility, status: "active" | "archived" = "active"): RoomForAuth {
  return { visibility, status, createdByUserId: "owner-user", scope: "room" };
}

const feedRoom: RoomForAuth = {
  visibility: "public",
  status: "active",
  createdByUserId: undefined,
  scope: "global",
};

describe("canLeave", () => {
  const visibilities: RoomVisibility[] = ["public", "open", "closed", "private"];

  it.each(visibilities)("an active non-owner member may leave a %s room", (visibility) => {
    expect(canLeave(room(visibility), user({ status: "active" }))).toBe(true);
  });

  it.each(visibilities)("the owner may not leave a %s room", (visibility) => {
    expect(canLeave(room(visibility), user({ status: "active", role: "owner" }))).toBe(false);
  });

  it("an admin with an active non-owner membership may leave", () => {
    expect(canLeave(room("closed"), user({ isAdmin: true, status: "active" }))).toBe(true);
  });

  it("an admin with no membership may not leave (nothing to leave)", () => {
    expect(canLeave(room("closed"), user({ isAdmin: true }))).toBe(false);
  });

  it("an admin who is also the owner may not leave", () => {
    expect(canLeave(room("closed"), user({ isAdmin: true, status: "active", role: "owner" }))).toBe(false);
  });

  it("a non-member may not leave", () => {
    expect(canLeave(room("public"), user())).toBe(false);
  });

  it("a pending member may not leave (not active yet)", () => {
    expect(canLeave(room("open"), user({ status: "pending" }))).toBe(false);
  });

  it("a banned member may not leave", () => {
    expect(canLeave(room("public"), user({ status: "banned" }))).toBe(false);
  });

  it("an active member may not leave an archived room", () => {
    expect(canLeave(room("public", "archived"), user({ status: "active" }))).toBe(false);
  });

  it("an anonymous visitor may not leave", () => {
    expect(canLeave(room("public"), anon)).toBe(false);
  });
});

describe("Feed room (scope: 'global') capabilities", () => {
  it("an authenticated user can post", () => {
    expect(computeRoomCapabilities(feedRoom, user()).canPost).toBe(true);
  });

  it("an anonymous visitor cannot post", () => {
    expect(computeRoomCapabilities(feedRoom, anon).canPost).toBe(false);
  });

  it("no one can discover, view, join, leave, invite, or manage it — not even an admin", () => {
    const admin = user({ isAdmin: true });
    const regular = user();

    for (const actor of [admin, regular, anon]) {
      const caps = computeRoomCapabilities(feedRoom, actor);
      expect(caps.canDiscover).toBe(false);
      expect(caps.canView).toBe(false);
      expect(caps.canViewMetadata).toBe(false);
      expect(caps.canJoin).toBe(false);
      expect(caps.canLeave).toBe(false);
      expect(caps.canInvite).toBe(false);
      expect(caps.canManage).toBe(false);
    }
  });

  it("an admin can still post, same as any other authenticated actor", () => {
    expect(computeRoomCapabilities(feedRoom, user({ isAdmin: true })).canPost).toBe(true);
  });
});
