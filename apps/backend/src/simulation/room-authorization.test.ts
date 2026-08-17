/**
 * Table-driven authorization tests for visibility × membership × actor kind.
 *
 * Each row in the table is one scenario. The test runner iterates over all rows
 * and asserts the expected capability values. Adding a new scenario is a single
 * line in the table; the test infrastructure handles the rest.
 *
 * Naming convention for actor labels:
 *   anon          – unauthenticated visitor
 *   user          – signed-in user with no membership
 *   user:pending  – signed-in user with a pending membership
 *   user:active   – signed-in user with an active (member) membership
 *   user:owner    – signed-in user with an active owner membership
 *   user:left     – signed-in user who left the room
 *   user:removed  – signed-in user who was removed
 *   user:banned   – signed-in user who was banned
 *   char          – character with no membership
 *   char:active   – character with an active membership
 *   admin         – signed-in admin (bypasses membership checks)
 */

import { describe, expect, it } from "vitest";
import {
  computeRoomCapabilities,
  canDiscover,
  canView,
  canPost,
  canJoin,
  canInvite,
  canManage,
  type RoomActor,
  type RoomCapabilities,
  type RoomForAuth,
} from "./room-authorization.js";
import type { MemberRole, MembershipStatus, RoomVisibility } from "@brickr/shared";

// ---------------------------------------------------------------------------
// Actor factories
// ---------------------------------------------------------------------------

const anon: RoomActor = { kind: "anonymous" };

function user(opts: { isAdmin?: boolean; status?: MembershipStatus; role?: MemberRole } = {}): RoomActor {
  const { isAdmin = false, status, role = "member" } = opts;
  if (status === undefined) {
    return { kind: "user", userId: "u1", isAdmin };
  }
  return {
    kind: "user",
    userId: "u1",
    isAdmin,
    membership: { memberKind: "user", role, status },
  };
}

function character(opts: { status?: MembershipStatus } = {}): RoomActor {
  const { status } = opts;
  if (status === undefined) {
    return { kind: "character", characterId: "c1" };
  }
  return {
    kind: "character",
    characterId: "c1",
    membership: { memberKind: "character", role: "member", status },
  };
}

// ---------------------------------------------------------------------------
// Room factories
// ---------------------------------------------------------------------------

function room(visibility: RoomVisibility, status: "active" | "archived" = "active"): RoomForAuth {
  return { visibility, status, createdByUserId: "owner-user", scope: "room" };
}

// ---------------------------------------------------------------------------
// Capability shorthand
// ---------------------------------------------------------------------------

type CapRow = {
  discover: boolean;
  view: boolean;
  viewMeta: boolean;
  post: boolean;
  join: boolean;
  invite: boolean;
  manage: boolean;
};

function caps(c: RoomCapabilities): CapRow {
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

// ---------------------------------------------------------------------------
// Table-driven test cases
// ---------------------------------------------------------------------------

type TestCase = {
  label: string;
  room: RoomForAuth;
  actor: RoomActor;
  expected: CapRow;
};

const ALL_FALSE: CapRow = {
  discover: false,
  view: false,
  viewMeta: false,
  post: false,
  join: false,
  invite: false,
  manage: false,
};

const testCases: TestCase[] = [
  // =========================================================================
  // PUBLIC rooms
  // =========================================================================

  {
    label: "public/active — anonymous: can discover and view, cannot post/join/invite/manage",
    room: room("public"),
    actor: anon,
    expected: {
      discover: true,
      view: true,
      viewMeta: true,
      post: false,
      join: false,
      invite: false,
      manage: false,
    },
  },
  {
    label: "public/active — user (no membership): can discover/view/post/join, cannot invite/manage",
    room: room("public"),
    actor: user(),
    expected: {
      discover: true,
      view: true,
      viewMeta: true,
      post: true,
      join: true,
      invite: false,
      manage: false,
    },
  },
  {
    label: "public/active — user:pending: can discover/view/post, cannot join (already has membership), cannot invite/manage",
    room: room("public"),
    actor: user({ status: "pending" }),
    expected: {
      discover: true,
      view: true,
      viewMeta: true,
      post: true,
      join: false, // already has a membership row
      invite: false,
      manage: false,
    },
  },
  {
    label: "public/active — user:active (member): can discover/view/post, cannot join (already active), cannot invite/manage",
    room: room("public"),
    actor: user({ status: "active" }),
    expected: {
      discover: true,
      view: true,
      viewMeta: true,
      post: true,
      join: false,
      invite: false,
      manage: false,
    },
  },
  {
    label: "public/active — user:owner: can do everything",
    room: room("public"),
    actor: user({ status: "active", role: "owner" }),
    expected: {
      discover: true,
      view: true,
      viewMeta: true,
      post: true,
      join: false, // already active
      invite: true,
      manage: true,
    },
  },
  {
    label: "public/active — user:left: can discover/view/post/join (re-join), cannot invite/manage",
    room: room("public"),
    actor: user({ status: "left" }),
    expected: {
      discover: true,
      view: true,
      viewMeta: true,
      post: true,
      join: true, // left → can re-join
      invite: false,
      manage: false,
    },
  },
  {
    label: "public/active — user:removed: can discover/view/post/join (re-join), cannot invite/manage",
    room: room("public"),
    actor: user({ status: "removed" }),
    expected: {
      discover: true,
      view: true,
      viewMeta: true,
      post: true,
      join: true,
      invite: false,
      manage: false,
    },
  },
  {
    label: "public/active — user:banned: can discover/view but cannot post/rejoin/invite/manage",
    room: room("public"),
    actor: user({ status: "banned" }),
    expected: {
      discover: true,
      view: true,
      viewMeta: true,
      post: false,
      join: false,
      invite: false,
      manage: false,
    },
  },
  {
    label: "public/active — char (no membership): can discover/view/post/join, cannot invite/manage",
    room: room("public"),
    actor: character(),
    expected: {
      discover: true,
      view: true,
      viewMeta: true,
      post: true,
      join: true,
      invite: false,
      manage: false,
    },
  },
  {
    label: "public/active — char:active: can discover/view/post, cannot join (already active), cannot invite/manage",
    room: room("public"),
    actor: character({ status: "active" }),
    expected: {
      discover: true,
      view: true,
      viewMeta: true,
      post: true,
      join: false,
      invite: false,
      manage: false,
    },
  },
  {
    label: "public/active — admin: can do everything except join (already has admin access)",
    room: room("public"),
    actor: user({ isAdmin: true }),
    expected: {
      discover: true,
      view: true,
      viewMeta: true,
      post: true,
      join: true, // admin with no membership can still join
      invite: true,
      manage: true,
    },
  },

  // =========================================================================
  // PUBLIC rooms — ARCHIVED
  //
  // Archived rooms are only accessible to their owner or an administrator,
  // regardless of visibility (§10.4). A stopped room "does not exist" for
  // anyone else through the room-scoped endpoints.
  // =========================================================================

  {
    label: "public/archived — anonymous: cannot discover/view/post/join/invite/manage",
    room: room("public", "archived"),
    actor: anon,
    expected: ALL_FALSE,
  },
  {
    label: "public/archived — user (no membership): cannot discover/view/post/join/invite/manage",
    room: room("public", "archived"),
    actor: user(),
    expected: ALL_FALSE,
  },
  {
    label: "public/archived — user:active (non-owner): cannot discover/view/post/join/invite/manage",
    room: room("public", "archived"),
    actor: user({ status: "active" }),
    expected: ALL_FALSE,
  },
  {
    label: "public/archived — user:owner: can discover/view/manage, cannot post/join/invite",
    room: room("public", "archived"),
    actor: user({ status: "active", role: "owner" }),
    expected: {
      discover: true,
      view: true,
      viewMeta: true,
      post: false,
      join: false,
      invite: false,
      manage: true,
    },
  },
  {
    label: "public/archived — admin: can discover/view/manage, cannot post/join/invite",
    room: room("public", "archived"),
    actor: user({ isAdmin: true }),
    expected: {
      discover: true,
      view: true,
      viewMeta: true,
      post: false,
      join: false,
      invite: false,
      manage: true,
    },
  },

  // =========================================================================
  // OPEN rooms
  // =========================================================================

  {
    label: "open/active — anonymous: can discover/view, cannot post/join/invite/manage",
    room: room("open"),
    actor: anon,
    expected: {
      discover: true,
      view: true,
      viewMeta: true,
      post: false,
      join: false,
      invite: false,
      manage: false,
    },
  },
  {
    label: "open/active — user (no membership): can discover/view/post/join, cannot invite/manage",
    room: room("open"),
    actor: user(),
    expected: {
      discover: true,
      view: true,
      viewMeta: true,
      post: true,
      join: true,
      invite: false,
      manage: false,
    },
  },
  {
    label: "open/active — user:active: can discover/view/post, cannot join (already active), cannot invite/manage",
    room: room("open"),
    actor: user({ status: "active" }),
    expected: {
      discover: true,
      view: true,
      viewMeta: true,
      post: true,
      join: false,
      invite: false,
      manage: false,
    },
  },
  {
    label: "open/active — user:owner: can discover/view/post/invite/manage, cannot join (already active)",
    room: room("open"),
    actor: user({ status: "active", role: "owner" }),
    expected: {
      discover: true,
      view: true,
      viewMeta: true,
      post: true,
      join: false,
      invite: true,
      manage: true,
    },
  },

  // =========================================================================
  // CLOSED rooms
  // =========================================================================

  {
    label: "closed/active — anonymous: cannot discover/view/post/join/invite/manage",
    room: room("closed"),
    actor: anon,
    expected: ALL_FALSE,
  },
  {
    label: "closed/active — user (no membership): cannot discover/view/post/join/invite/manage",
    room: room("closed"),
    actor: user(),
    expected: ALL_FALSE,
  },
  {
    label: "closed/active — user:pending: cannot discover/view/post/join/invite/manage (pending is not active)",
    room: room("closed"),
    actor: user({ status: "pending" }),
    expected: ALL_FALSE,
  },
  {
    label: "closed/active — user:active (member): can discover/view/post, cannot join/invite/manage",
    room: room("closed"),
    actor: user({ status: "active" }),
    expected: {
      discover: true,
      view: true,
      viewMeta: true,
      post: true,
      join: false,
      invite: false,
      manage: false,
    },
  },
  {
    label: "closed/active — user:owner: can discover/view/post/invite/manage, cannot join (already active)",
    room: room("closed"),
    actor: user({ status: "active", role: "owner" }),
    expected: {
      discover: true,
      view: true,
      viewMeta: true,
      post: true,
      join: false,
      invite: true,
      manage: true,
    },
  },
  {
    label: "closed/active — user:left: cannot discover/view/post/join/invite/manage",
    room: room("closed"),
    actor: user({ status: "left" }),
    expected: ALL_FALSE,
  },
  {
    label: "closed/active — user:removed: cannot discover/view/post/join/invite/manage",
    room: room("closed"),
    actor: user({ status: "removed" }),
    expected: ALL_FALSE,
  },
  {
    label: "closed/active — user:banned: cannot discover/view/post/join/invite/manage",
    room: room("closed"),
    actor: user({ status: "banned" }),
    expected: ALL_FALSE,
  },
  {
    label: "closed/active — char (no membership): cannot discover/view/post/join/invite/manage",
    room: room("closed"),
    actor: character(),
    expected: ALL_FALSE,
  },
  {
    label: "closed/active — char:active: can discover/view/post, cannot join/invite/manage",
    room: room("closed"),
    actor: character({ status: "active" }),
    expected: {
      discover: true,
      view: true,
      viewMeta: true,
      post: true,
      join: false,
      invite: false,
      manage: false,
    },
  },
  {
    label: "closed/active — admin: can do everything (post/invite/manage), cannot join (no membership but admin bypasses)",
    room: room("closed"),
    actor: user({ isAdmin: true }),
    expected: {
      discover: true,
      view: true,
      viewMeta: true,
      post: true,
      join: true, // admin with no membership can still join
      invite: true,
      manage: true,
    },
  },

  // =========================================================================
  // PRIVATE rooms
  // =========================================================================

  {
    label: "private/active — anonymous: cannot discover/view/post/join/invite/manage",
    room: room("private"),
    actor: anon,
    expected: ALL_FALSE,
  },
  {
    label: "private/active — user (no membership): cannot discover/view/post/join/invite/manage",
    room: room("private"),
    actor: user(),
    expected: ALL_FALSE,
  },
  {
    label: "private/active — user:active (member): can discover/view/post, cannot join/invite/manage",
    room: room("private"),
    actor: user({ status: "active" }),
    expected: {
      discover: true,
      view: true,
      viewMeta: true,
      post: true,
      join: false,
      invite: false,
      manage: false,
    },
  },
  {
    label: "private/active — user:owner: can discover/view/post/invite/manage, cannot join (already active)",
    room: room("private"),
    actor: user({ status: "active", role: "owner" }),
    expected: {
      discover: true,
      view: true,
      viewMeta: true,
      post: true,
      join: false,
      invite: true,
      manage: true,
    },
  },
  {
    label: "private/active — char (no membership): cannot discover/view/post/join/invite/manage",
    room: room("private"),
    actor: character(),
    expected: ALL_FALSE,
  },
  {
    label: "private/active — char:active: can discover/view/post, cannot join/invite/manage",
    room: room("private"),
    actor: character({ status: "active" }),
    expected: {
      discover: true,
      view: true,
      viewMeta: true,
      post: true,
      join: false,
      invite: false,
      manage: false,
    },
  },
  {
    label: "private/active — admin: can do everything",
    room: room("private"),
    actor: user({ isAdmin: true }),
    expected: {
      discover: true,
      view: true,
      viewMeta: true,
      post: true,
      join: true,
      invite: true,
      manage: true,
    },
  },

  // =========================================================================
  // PRIVATE rooms — ARCHIVED
  //
  // Archived rooms are only accessible to their owner or an administrator,
  // regardless of visibility (§10.4).
  // =========================================================================

  {
    label: "private/archived — user:active (non-owner): cannot discover/view/post/join/invite/manage",
    room: room("private", "archived"),
    actor: user({ status: "active" }),
    expected: ALL_FALSE,
  },
  {
    label: "private/archived — user:owner: can discover/view/manage, cannot post/join/invite",
    room: room("private", "archived"),
    actor: user({ status: "active", role: "owner" }),
    expected: {
      discover: true,
      view: true,
      viewMeta: true,
      post: false,
      join: false,
      invite: false,
      manage: true,
    },
  },
  {
    label: "private/archived — admin: can discover/view/manage, cannot post/join/invite",
    room: room("private", "archived"),
    actor: user({ isAdmin: true }),
    expected: {
      discover: true,
      view: true,
      viewMeta: true,
      post: false,
      join: false,
      invite: false,
      manage: true,
    },
  },
  {
    label: "private/archived — user (no membership): cannot discover/view/post/join/invite/manage",
    room: room("private", "archived"),
    actor: user(),
    expected: ALL_FALSE,
  },
];

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

describe("computeRoomCapabilities — table-driven authorization matrix", () => {
  for (const tc of testCases) {
    it(tc.label, () => {
      const result = computeRoomCapabilities(tc.room, tc.actor);
      expect(caps(result)).toEqual(tc.expected);
    });
  }
});

// ---------------------------------------------------------------------------
// Focused unit tests for specific rules
// ---------------------------------------------------------------------------

describe("computeRoomCapabilities — admin bypass", () => {
  it("admin with active membership in a closed room: join is false (already a member)", () => {
    const result = computeRoomCapabilities(
      room("closed"),
      user({ isAdmin: true, status: "active" }),
    );
    expect(result.canJoin).toBe(false);
  });

  it("admin with active owner membership: manage is true", () => {
    const result = computeRoomCapabilities(
      room("private"),
      user({ isAdmin: true, status: "active", role: "owner" }),
    );
    expect(result.canManage).toBe(true);
  });
});

describe("computeRoomCapabilities — archived rooms block posting for all", () => {
  const visibilities: RoomVisibility[] = ["public", "open", "closed", "private"];
  const actors: Array<{ label: string; actor: RoomActor }> = [
    { label: "anonymous", actor: anon },
    { label: "user (no membership)", actor: user() },
    { label: "user:active", actor: user({ status: "active" }) },
    { label: "user:owner", actor: user({ status: "active", role: "owner" }) },
    { label: "admin", actor: user({ isAdmin: true }) },
    { label: "char:active", actor: character({ status: "active" }) },
  ];

  for (const visibility of visibilities) {
    for (const { label, actor } of actors) {
      it(`${visibility}/archived — ${label}: canPost is false`, () => {
        const result = computeRoomCapabilities(room(visibility, "archived"), actor);
        expect(result.canPost).toBe(false);
      });
    }
  }
});

describe("computeRoomCapabilities — archived rooms are only visible to owner/admin", () => {
  const visibilities: RoomVisibility[] = ["public", "open", "closed", "private"];
  const nonOwnerActors: Array<{ label: string; actor: RoomActor }> = [
    { label: "anonymous", actor: anon },
    { label: "user (no membership)", actor: user() },
    { label: "user:active (non-owner)", actor: user({ status: "active" }) },
    { label: "char:active", actor: character({ status: "active" }) },
  ];

  for (const visibility of visibilities) {
    for (const { label, actor } of nonOwnerActors) {
      it(`${visibility}/archived — ${label}: canView and canDiscover are false`, () => {
        const result = computeRoomCapabilities(room(visibility, "archived"), actor);
        expect(result.canView).toBe(false);
        expect(result.canDiscover).toBe(false);
      });
    }
  }

  it("owner can view an archived room", () => {
    const result = computeRoomCapabilities(
      room("public", "archived"),
      user({ status: "active", role: "owner" }),
    );
    expect(result.canView).toBe(true);
    expect(result.canDiscover).toBe(true);
  });

  it("admin can view an archived room", () => {
    const result = computeRoomCapabilities(room("private", "archived"), user({ isAdmin: true }));
    expect(result.canView).toBe(true);
    expect(result.canDiscover).toBe(true);
  });
});

describe("computeRoomCapabilities — only owner can invite", () => {
  it("active member (non-owner) cannot invite", () => {
    const result = computeRoomCapabilities(
      room("public"),
      user({ status: "active", role: "member" }),
    );
    expect(result.canInvite).toBe(false);
  });

  it("owner can invite in an active room", () => {
    const result = computeRoomCapabilities(
      room("public"),
      user({ status: "active", role: "owner" }),
    );
    expect(result.canInvite).toBe(true);
  });

  it("owner cannot invite in an archived room", () => {
    const result = computeRoomCapabilities(
      room("public", "archived"),
      user({ status: "active", role: "owner" }),
    );
    expect(result.canInvite).toBe(false);
  });
});

describe("computeRoomCapabilities — only owner or admin can manage", () => {
  it("active member (non-owner) cannot manage", () => {
    const result = computeRoomCapabilities(
      room("public"),
      user({ status: "active", role: "member" }),
    );
    expect(result.canManage).toBe(false);
  });

  it("owner can manage", () => {
    const result = computeRoomCapabilities(
      room("public"),
      user({ status: "active", role: "owner" }),
    );
    expect(result.canManage).toBe(true);
  });

  it("admin can manage even without membership", () => {
    const result = computeRoomCapabilities(room("private"), user({ isAdmin: true }));
    expect(result.canManage).toBe(true);
  });
});

describe("computeRoomCapabilities — closed/private non-member metadata restriction", () => {
  it("closed room — non-member cannot view metadata", () => {
    const result = computeRoomCapabilities(room("closed"), user());
    expect(result.canViewMetadata).toBe(false);
    expect(result.canView).toBe(false);
  });

  it("private room — non-member cannot view metadata", () => {
    const result = computeRoomCapabilities(room("private"), user());
    expect(result.canViewMetadata).toBe(false);
    expect(result.canView).toBe(false);
  });

  it("closed room — active member can view metadata", () => {
    const result = computeRoomCapabilities(room("closed"), user({ status: "active" }));
    expect(result.canViewMetadata).toBe(true);
    expect(result.canView).toBe(true);
  });

  it("public room — anonymous can view metadata", () => {
    const result = computeRoomCapabilities(room("public"), anon);
    expect(result.canViewMetadata).toBe(true);
    expect(result.canView).toBe(true);
  });

  it("archived public room — non-owner cannot view metadata (archived overrides visibility)", () => {
    const result = computeRoomCapabilities(room("public", "archived"), user());
    expect(result.canViewMetadata).toBe(false);
    expect(result.canView).toBe(false);
  });
});

describe("computeRoomCapabilities — banned actors", () => {
  it("cannot post or re-join an open room", () => {
    const result = computeRoomCapabilities(room("open"), user({ status: "banned" }));
    expect(result.canPost).toBe(false);
    expect(result.canJoin).toBe(false);
  });
});

describe("computeRoomCapabilities — character actors", () => {
  it("character is never an owner and cannot manage", () => {
    // Even with an active membership, characters hold the 'member' role only.
    const result = computeRoomCapabilities(
      room("public"),
      character({ status: "active" }),
    );
    expect(result.canManage).toBe(false);
    expect(result.canInvite).toBe(false);
  });

  it("character with no membership in a public room can post", () => {
    const result = computeRoomCapabilities(room("public"), character());
    expect(result.canPost).toBe(true);
  });

  it("character with no membership in a closed room cannot post", () => {
    const result = computeRoomCapabilities(room("closed"), character());
    expect(result.canPost).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Convenience function smoke tests
// ---------------------------------------------------------------------------

describe("convenience functions delegate to computeRoomCapabilities", () => {
  it("canDiscover returns the same value as computeRoomCapabilities", () => {
    const r = room("public");
    const a = anon;
    expect(canDiscover(r, a)).toBe(computeRoomCapabilities(r, a).canDiscover);
  });

  it("canView returns the same value as computeRoomCapabilities", () => {
    const r = room("closed");
    const a = user();
    expect(canView(r, a)).toBe(computeRoomCapabilities(r, a).canView);
  });

  it("canPost returns the same value as computeRoomCapabilities", () => {
    const r = room("open");
    const a = user({ status: "active" });
    expect(canPost(r, a)).toBe(computeRoomCapabilities(r, a).canPost);
  });

  it("canJoin returns the same value as computeRoomCapabilities", () => {
    const r = room("open");
    const a = user();
    expect(canJoin(r, a)).toBe(computeRoomCapabilities(r, a).canJoin);
  });

  it("canInvite returns the same value as computeRoomCapabilities", () => {
    const r = room("public");
    const a = user({ status: "active", role: "owner" });
    expect(canInvite(r, a)).toBe(computeRoomCapabilities(r, a).canInvite);
  });

  it("canManage returns the same value as computeRoomCapabilities", () => {
    const r = room("private");
    const a = user({ isAdmin: true });
    expect(canManage(r, a)).toBe(computeRoomCapabilities(r, a).canManage);
  });
});
