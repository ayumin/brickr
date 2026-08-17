/**
 * Complete authorization matrix: visibility × membership × actor kind (issue #171).
 *
 * This file provides a single exhaustive table that covers every combination of:
 *   - Room visibility: public | open | closed | private
 *   - Room status:     active | archived
 *   - Actor kind:      anonymous | user | character | admin
 *   - Membership:      none | pending | active | owner | left | removed | banned
 *
 * Each row asserts the full capability set (discover, view, viewMeta, post,
 * join, invite, manage) so a single change to the authorization logic is
 * immediately visible as a diff in this table.
 *
 * The table is the specification. If a row fails, either the implementation
 * or the expected value is wrong — decide which before changing either.
 */

import { describe, expect, it } from "vitest";
import {
  computeRoomCapabilities,
  type RoomActor,
  type RoomCapabilities,
  type RoomForAuth,
} from "./room-authorization.js";
import type { MemberRole, MembershipStatus, RoomVisibility } from "@brickr/shared";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

const anon: RoomActor = { kind: "anonymous" };

function user(
  opts: { isAdmin?: boolean; status?: MembershipStatus; role?: MemberRole } = {},
): RoomActor {
  const { isAdmin = false, status, role = "member" } = opts;
  if (status === undefined) return { kind: "user", userId: "u1", isAdmin };
  return {
    kind: "user",
    userId: "u1",
    isAdmin,
    membership: { memberKind: "user", role, status },
  };
}

function character(opts: { status?: MembershipStatus } = {}): RoomActor {
  const { status } = opts;
  if (status === undefined) return { kind: "character", characterId: "c1" };
  return {
    kind: "character",
    characterId: "c1",
    membership: { memberKind: "character", role: "member", status },
  };
}

function room(
  visibility: RoomVisibility,
  status: "active" | "archived" = "active",
): RoomForAuth {
  return { visibility, status, createdByUserId: "owner-user", scope: "room" };
}

// Shorthand for the full capability set.
type Cap = {
  discover: boolean;
  view: boolean;
  viewMeta: boolean;
  post: boolean;
  join: boolean;
  invite: boolean;
  manage: boolean;
};

function caps(c: RoomCapabilities): Cap {
  return {
    discover: c.canDiscover,
    view: c.canView,
    viewMeta: c.canViewMetadata,
    post: c.canPost,
    join: c.canJoin,
    invite: c.canInvite,
    manage: c.canManage,
  };
}

const NONE: Cap = {
  discover: false,
  view: false,
  viewMeta: false,
  post: false,
  join: false,
  invite: false,
  manage: false,
};

// ---------------------------------------------------------------------------
// Matrix rows
// ---------------------------------------------------------------------------

type Row = {
  label: string;
  room: RoomForAuth;
  actor: RoomActor;
  expected: Cap;
};

const matrix: Row[] = [
  // =========================================================================
  // PUBLIC / ACTIVE
  // =========================================================================
  {
    label: "public/active × anon",
    room: room("public"),
    actor: anon,
    expected: { discover: true, view: true, viewMeta: true, post: false, join: false, invite: false, manage: false },
  },
  {
    label: "public/active × user (no membership)",
    room: room("public"),
    actor: user(),
    expected: { discover: true, view: true, viewMeta: true, post: true, join: true, invite: false, manage: false },
  },
  {
    label: "public/active × user:pending",
    room: room("public"),
    actor: user({ status: "pending" }),
    expected: { discover: true, view: true, viewMeta: true, post: true, join: false, invite: false, manage: false },
  },
  {
    label: "public/active × user:active (member)",
    room: room("public"),
    actor: user({ status: "active" }),
    expected: { discover: true, view: true, viewMeta: true, post: true, join: false, invite: false, manage: false },
  },
  {
    label: "public/active × user:owner",
    room: room("public"),
    actor: user({ status: "active", role: "owner" }),
    expected: { discover: true, view: true, viewMeta: true, post: true, join: false, invite: true, manage: true },
  },
  {
    label: "public/active × user:left",
    room: room("public"),
    actor: user({ status: "left" }),
    expected: { discover: true, view: true, viewMeta: true, post: true, join: true, invite: false, manage: false },
  },
  {
    label: "public/active × user:removed",
    room: room("public"),
    actor: user({ status: "removed" }),
    expected: { discover: true, view: true, viewMeta: true, post: true, join: true, invite: false, manage: false },
  },
  {
    label: "public/active × user:banned",
    room: room("public"),
    actor: user({ status: "banned" }),
    expected: { discover: true, view: true, viewMeta: true, post: false, join: false, invite: false, manage: false },
  },
  {
    label: "public/active × char (no membership)",
    room: room("public"),
    actor: character(),
    expected: { discover: true, view: true, viewMeta: true, post: true, join: true, invite: false, manage: false },
  },
  {
    label: "public/active × char:active",
    room: room("public"),
    actor: character({ status: "active" }),
    expected: { discover: true, view: true, viewMeta: true, post: true, join: false, invite: false, manage: false },
  },
  {
    label: "public/active × admin (no membership)",
    room: room("public"),
    actor: user({ isAdmin: true }),
    expected: { discover: true, view: true, viewMeta: true, post: true, join: true, invite: true, manage: true },
  },
  {
    label: "public/active × admin (active member)",
    room: room("public"),
    actor: user({ isAdmin: true, status: "active" }),
    expected: { discover: true, view: true, viewMeta: true, post: true, join: false, invite: true, manage: true },
  },

  // =========================================================================
  // PUBLIC / ARCHIVED
  // =========================================================================
  {
    label: "public/archived × anon",
    room: room("public", "archived"),
    actor: anon,
    expected: NONE,
  },
  {
    label: "public/archived × user (no membership)",
    room: room("public", "archived"),
    actor: user(),
    expected: NONE,
  },
  {
    label: "public/archived × user:active (non-owner)",
    room: room("public", "archived"),
    actor: user({ status: "active" }),
    expected: NONE,
  },
  {
    label: "public/archived × user:owner",
    room: room("public", "archived"),
    actor: user({ status: "active", role: "owner" }),
    expected: { discover: true, view: true, viewMeta: true, post: false, join: false, invite: false, manage: true },
  },
  {
    label: "public/archived × admin",
    room: room("public", "archived"),
    actor: user({ isAdmin: true }),
    expected: { discover: true, view: true, viewMeta: true, post: false, join: false, invite: false, manage: true },
  },

  // =========================================================================
  // OPEN / ACTIVE
  // =========================================================================
  {
    label: "open/active × anon",
    room: room("open"),
    actor: anon,
    expected: { discover: true, view: true, viewMeta: true, post: false, join: false, invite: false, manage: false },
  },
  {
    label: "open/active × user (no membership)",
    room: room("open"),
    actor: user(),
    expected: { discover: true, view: true, viewMeta: true, post: true, join: true, invite: false, manage: false },
  },
  {
    label: "open/active × user:pending",
    room: room("open"),
    actor: user({ status: "pending" }),
    expected: { discover: true, view: true, viewMeta: true, post: true, join: false, invite: false, manage: false },
  },
  {
    label: "open/active × user:active",
    room: room("open"),
    actor: user({ status: "active" }),
    expected: { discover: true, view: true, viewMeta: true, post: true, join: false, invite: false, manage: false },
  },
  {
    label: "open/active × user:owner",
    room: room("open"),
    actor: user({ status: "active", role: "owner" }),
    expected: { discover: true, view: true, viewMeta: true, post: true, join: false, invite: true, manage: true },
  },
  {
    label: "open/active × user:banned",
    room: room("open"),
    actor: user({ status: "banned" }),
    expected: { discover: true, view: true, viewMeta: true, post: false, join: false, invite: false, manage: false },
  },
  {
    label: "open/active × admin",
    room: room("open"),
    actor: user({ isAdmin: true }),
    expected: { discover: true, view: true, viewMeta: true, post: true, join: true, invite: true, manage: true },
  },

  // =========================================================================
  // OPEN / ARCHIVED
  // =========================================================================
  {
    label: "open/archived × user (no membership)",
    room: room("open", "archived"),
    actor: user(),
    expected: NONE,
  },
  {
    label: "open/archived × user:owner",
    room: room("open", "archived"),
    actor: user({ status: "active", role: "owner" }),
    expected: { discover: true, view: true, viewMeta: true, post: false, join: false, invite: false, manage: true },
  },
  {
    label: "open/archived × admin",
    room: room("open", "archived"),
    actor: user({ isAdmin: true }),
    expected: { discover: true, view: true, viewMeta: true, post: false, join: false, invite: false, manage: true },
  },

  // =========================================================================
  // CLOSED / ACTIVE
  // =========================================================================
  {
    label: "closed/active × anon",
    room: room("closed"),
    actor: anon,
    expected: NONE,
  },
  {
    label: "closed/active × user (no membership)",
    room: room("closed"),
    actor: user(),
    expected: NONE,
  },
  {
    label: "closed/active × user:pending",
    room: room("closed"),
    actor: user({ status: "pending" }),
    expected: NONE,
  },
  {
    label: "closed/active × user:active (member)",
    room: room("closed"),
    actor: user({ status: "active" }),
    expected: { discover: true, view: true, viewMeta: true, post: true, join: false, invite: false, manage: false },
  },
  {
    label: "closed/active × user:owner",
    room: room("closed"),
    actor: user({ status: "active", role: "owner" }),
    expected: { discover: true, view: true, viewMeta: true, post: true, join: false, invite: true, manage: true },
  },
  {
    label: "closed/active × user:left",
    room: room("closed"),
    actor: user({ status: "left" }),
    expected: NONE,
  },
  {
    label: "closed/active × user:removed",
    room: room("closed"),
    actor: user({ status: "removed" }),
    expected: NONE,
  },
  {
    label: "closed/active × user:banned",
    room: room("closed"),
    actor: user({ status: "banned" }),
    expected: NONE,
  },
  {
    label: "closed/active × char (no membership)",
    room: room("closed"),
    actor: character(),
    expected: NONE,
  },
  {
    label: "closed/active × char:active",
    room: room("closed"),
    actor: character({ status: "active" }),
    expected: { discover: true, view: true, viewMeta: true, post: true, join: false, invite: false, manage: false },
  },
  {
    label: "closed/active × admin (no membership)",
    room: room("closed"),
    actor: user({ isAdmin: true }),
    expected: { discover: true, view: true, viewMeta: true, post: true, join: true, invite: true, manage: true },
  },
  {
    label: "closed/active × admin (active member)",
    room: room("closed"),
    actor: user({ isAdmin: true, status: "active" }),
    expected: { discover: true, view: true, viewMeta: true, post: true, join: false, invite: true, manage: true },
  },

  // =========================================================================
  // CLOSED / ARCHIVED
  // =========================================================================
  {
    label: "closed/archived × user (no membership)",
    room: room("closed", "archived"),
    actor: user(),
    expected: NONE,
  },
  {
    label: "closed/archived × user:active (non-owner)",
    room: room("closed", "archived"),
    actor: user({ status: "active" }),
    expected: NONE,
  },
  {
    label: "closed/archived × user:owner",
    room: room("closed", "archived"),
    actor: user({ status: "active", role: "owner" }),
    expected: { discover: true, view: true, viewMeta: true, post: false, join: false, invite: false, manage: true },
  },
  {
    label: "closed/archived × admin",
    room: room("closed", "archived"),
    actor: user({ isAdmin: true }),
    expected: { discover: true, view: true, viewMeta: true, post: false, join: false, invite: false, manage: true },
  },

  // =========================================================================
  // PRIVATE / ACTIVE
  // =========================================================================
  {
    label: "private/active × anon",
    room: room("private"),
    actor: anon,
    expected: NONE,
  },
  {
    label: "private/active × user (no membership)",
    room: room("private"),
    actor: user(),
    expected: NONE,
  },
  {
    label: "private/active × user:pending",
    room: room("private"),
    actor: user({ status: "pending" }),
    expected: NONE,
  },
  {
    label: "private/active × user:active (member)",
    room: room("private"),
    actor: user({ status: "active" }),
    expected: { discover: true, view: true, viewMeta: true, post: true, join: false, invite: false, manage: false },
  },
  {
    label: "private/active × user:owner",
    room: room("private"),
    actor: user({ status: "active", role: "owner" }),
    expected: { discover: true, view: true, viewMeta: true, post: true, join: false, invite: true, manage: true },
  },
  {
    label: "private/active × user:left",
    room: room("private"),
    actor: user({ status: "left" }),
    expected: NONE,
  },
  {
    label: "private/active × user:removed",
    room: room("private"),
    actor: user({ status: "removed" }),
    expected: NONE,
  },
  {
    label: "private/active × user:banned",
    room: room("private"),
    actor: user({ status: "banned" }),
    expected: NONE,
  },
  {
    label: "private/active × char (no membership)",
    room: room("private"),
    actor: character(),
    expected: NONE,
  },
  {
    label: "private/active × char:active",
    room: room("private"),
    actor: character({ status: "active" }),
    expected: { discover: true, view: true, viewMeta: true, post: true, join: false, invite: false, manage: false },
  },
  {
    label: "private/active × admin (no membership)",
    room: room("private"),
    actor: user({ isAdmin: true }),
    expected: { discover: true, view: true, viewMeta: true, post: true, join: true, invite: true, manage: true },
  },

  // =========================================================================
  // PRIVATE / ARCHIVED
  // =========================================================================
  {
    label: "private/archived × anon",
    room: room("private", "archived"),
    actor: anon,
    expected: NONE,
  },
  {
    label: "private/archived × user (no membership)",
    room: room("private", "archived"),
    actor: user(),
    expected: NONE,
  },
  {
    label: "private/archived × user:active (non-owner)",
    room: room("private", "archived"),
    actor: user({ status: "active" }),
    expected: NONE,
  },
  {
    label: "private/archived × user:owner",
    room: room("private", "archived"),
    actor: user({ status: "active", role: "owner" }),
    expected: { discover: true, view: true, viewMeta: true, post: false, join: false, invite: false, manage: true },
  },
  {
    label: "private/archived × admin",
    room: room("private", "archived"),
    actor: user({ isAdmin: true }),
    expected: { discover: true, view: true, viewMeta: true, post: false, join: false, invite: false, manage: true },
  },
];

// ---------------------------------------------------------------------------
// Table-driven runner
// ---------------------------------------------------------------------------

describe("room authorization matrix — visibility × membership × actor (issue #171)", () => {
  for (const row of matrix) {
    it(row.label, () => {
      expect(caps(computeRoomCapabilities(row.room, row.actor))).toEqual(row.expected);
    });
  }
});

// ---------------------------------------------------------------------------
// Cross-cutting invariants derived from the matrix
// ---------------------------------------------------------------------------

describe("authorization matrix invariants", () => {
  it("no actor can post into an archived room (all visibilities)", () => {
    const visibilities: RoomVisibility[] = ["public", "open", "closed", "private"];
    const actors: RoomActor[] = [
      anon,
      user(),
      user({ status: "active" }),
      user({ status: "active", role: "owner" }),
      user({ isAdmin: true }),
      character(),
      character({ status: "active" }),
    ];
    for (const vis of visibilities) {
      for (const actor of actors) {
        const result = computeRoomCapabilities(room(vis, "archived"), actor);
        expect(result.canPost, `${vis}/archived × ${actor.kind}`).toBe(false);
      }
    }
  });

  it("no actor can invite into an archived room (all visibilities)", () => {
    const visibilities: RoomVisibility[] = ["public", "open", "closed", "private"];
    const actors: RoomActor[] = [
      user({ status: "active", role: "owner" }),
      user({ isAdmin: true }),
    ];
    for (const vis of visibilities) {
      for (const actor of actors) {
        const result = computeRoomCapabilities(room(vis, "archived"), actor);
        expect(result.canInvite, `${vis}/archived × ${actor.kind}`).toBe(false);
      }
    }
  });

  it("banned actors cannot post or join in any active room", () => {
    const visibilities: RoomVisibility[] = ["public", "open", "closed", "private"];
    for (const vis of visibilities) {
      const result = computeRoomCapabilities(room(vis), user({ status: "banned" }));
      expect(result.canPost, `${vis} banned`).toBe(false);
      expect(result.canJoin, `${vis} banned`).toBe(false);
    }
  });

  it("characters are never owners and cannot manage or invite", () => {
    const visibilities: RoomVisibility[] = ["public", "open", "closed", "private"];
    for (const vis of visibilities) {
      const result = computeRoomCapabilities(room(vis), character({ status: "active" }));
      expect(result.canManage, `${vis} char:active`).toBe(false);
      expect(result.canInvite, `${vis} char:active`).toBe(false);
    }
  });

  it("anonymous actors cannot post or join in any room", () => {
    const visibilities: RoomVisibility[] = ["public", "open", "closed", "private"];
    for (const vis of visibilities) {
      const result = computeRoomCapabilities(room(vis), anon);
      expect(result.canPost, `${vis} anon`).toBe(false);
      expect(result.canJoin, `${vis} anon`).toBe(false);
      expect(result.canInvite, `${vis} anon`).toBe(false);
      expect(result.canManage, `${vis} anon`).toBe(false);
    }
  });

  it("closed/private rooms are invisible to non-members (discover and view both false)", () => {
    const restrictedVisibilities: RoomVisibility[] = ["closed", "private"];
    const nonMembers: RoomActor[] = [anon, user(), user({ status: "left" }), user({ status: "removed" })];
    for (const vis of restrictedVisibilities) {
      for (const actor of nonMembers) {
        const result = computeRoomCapabilities(room(vis), actor);
        expect(result.canDiscover, `${vis} non-member`).toBe(false);
        expect(result.canView, `${vis} non-member`).toBe(false);
      }
    }
  });

  it("public/open rooms are discoverable by everyone including anonymous", () => {
    const openVisibilities: RoomVisibility[] = ["public", "open"];
    for (const vis of openVisibilities) {
      const result = computeRoomCapabilities(room(vis), anon);
      expect(result.canDiscover, `${vis} anon`).toBe(true);
      expect(result.canView, `${vis} anon`).toBe(true);
    }
  });

  it("only owner or admin can manage a room", () => {
    const visibilities: RoomVisibility[] = ["public", "open", "closed", "private"];
    const nonManagers: RoomActor[] = [
      anon,
      user(),
      user({ status: "active" }), // member but not owner
      character({ status: "active" }),
    ];
    for (const vis of visibilities) {
      for (const actor of nonManagers) {
        const result = computeRoomCapabilities(room(vis), actor);
        expect(result.canManage, `${vis} non-manager`).toBe(false);
      }
    }
  });

  it("pending membership does not grant view access to closed/private rooms", () => {
    const restrictedVisibilities: RoomVisibility[] = ["closed", "private"];
    for (const vis of restrictedVisibilities) {
      const result = computeRoomCapabilities(room(vis), user({ status: "pending" }));
      expect(result.canView, `${vis} pending`).toBe(false);
      expect(result.canPost, `${vis} pending`).toBe(false);
    }
  });
});
