/**
 * Tests for the visibility-aware room list (issue #155).
 *
 * Covers:
 *   - toRoomListEntryDto: metadata restriction for closed non-members,
 *     pendingCount for owners, full entry for members/admins
 *
 * Repository-level tests (findAllVisibleTo visibility query) live in
 * simulation-repository.test.ts alongside the other repository tests.
 */
import { describe, expect, it } from "vitest";
import {
  toRoomListEntryDto,
  type SimulationActor,
} from "./simulation-service.js";
import type { SimulationSummary } from "./simulation.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER: SimulationActor = { id: "user-owner", isAdmin: false };
const MEMBER: SimulationActor = { id: "user-member", isAdmin: false };
const NON_MEMBER: SimulationActor = { id: "user-other", isAdmin: false };
const ADMIN: SimulationActor = { id: "user-admin", isAdmin: true };

const BASE_DATE = new Date("2026-08-16T00:00:00.000Z");

function makeSummary(overrides: Partial<SimulationSummary> = {}): SimulationSummary {
  return {
    id: "room-1",
    title: "テストルーム",
    status: "active",
    scope: "room",
    visibility: "public",
    tags: [],
    createdAt: BASE_DATE,
    lastActivityAt: BASE_DATE,
    createdByUserId: OWNER.id,
    postCount: 5,
    creator: { id: OWNER.id, handle: "owner", displayName: "オーナー" },
    pendingCount: 0,
    callerIsActiveMember: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// toRoomListEntryDto — public rooms
// ---------------------------------------------------------------------------

describe("toRoomListEntryDto — public rooms", () => {
  it("returns a full (non-restricted) entry for a public room", () => {
    const summary = makeSummary({ visibility: "public" });
    const entry = toRoomListEntryDto(summary, NON_MEMBER);
    expect(entry.restricted).toBe(false);
  });

  it("includes postCount and creator for public rooms", () => {
    const summary = makeSummary({ visibility: "public", postCount: 7 });
    const entry = toRoomListEntryDto(summary, NON_MEMBER);
    if (entry.restricted) throw new Error("expected non-restricted");
    expect(entry.postCount).toBe(7);
    expect(entry.creator).toEqual({ id: OWNER.id, handle: "owner", displayName: "オーナー" });
  });

  it("does not include pendingCount for non-owners of public rooms", () => {
    const summary = makeSummary({ visibility: "public", pendingCount: 3 });
    const entry = toRoomListEntryDto(summary, NON_MEMBER);
    if (entry.restricted) throw new Error("expected non-restricted");
    expect(entry).not.toHaveProperty("pendingCount");
  });
});

// ---------------------------------------------------------------------------
// toRoomListEntryDto — open rooms
// ---------------------------------------------------------------------------

describe("toRoomListEntryDto — open rooms", () => {
  it("returns a full entry for an open room for non-members", () => {
    const summary = makeSummary({ visibility: "open" });
    const entry = toRoomListEntryDto(summary, NON_MEMBER);
    expect(entry.restricted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toRoomListEntryDto — closed rooms
// ---------------------------------------------------------------------------

describe("toRoomListEntryDto — closed rooms", () => {
  it("returns a restricted entry for a closed room when the caller is not an active member", () => {
    const summary = makeSummary({
      visibility: "closed",
      callerIsActiveMember: false,
    });
    const entry = toRoomListEntryDto(summary, NON_MEMBER);
    expect(entry.restricted).toBe(true);
  });

  it("restricted entry contains only id, title, visibility, createdAt", () => {
    const summary = makeSummary({
      visibility: "closed",
      callerIsActiveMember: false,
    });
    const entry = toRoomListEntryDto(summary, NON_MEMBER);
    if (!entry.restricted) throw new Error("expected restricted");
    expect(entry).toEqual({
      restricted: true,
      id: "room-1",
      title: "テストルーム",
      visibility: "closed",
      createdAt: BASE_DATE.toISOString(),
    });
    // Must not expose full metadata
    expect(entry).not.toHaveProperty("postCount");
    expect(entry).not.toHaveProperty("creator");
    expect(entry).not.toHaveProperty("canManage");
    expect(entry).not.toHaveProperty("pendingCount");
  });

  it("returns a full entry for a closed room when the caller is an active member", () => {
    const summary = makeSummary({
      visibility: "closed",
      callerIsActiveMember: true,
    });
    const entry = toRoomListEntryDto(summary, MEMBER);
    expect(entry.restricted).toBe(false);
  });

  it("returns a full entry for a closed room when the caller is the owner", () => {
    const summary = makeSummary({
      visibility: "closed",
      callerIsActiveMember: false, // owner may not have active membership in snapshot
    });
    const entry = toRoomListEntryDto(summary, OWNER);
    expect(entry.restricted).toBe(false);
  });

  it("returns a full entry for a closed room when the caller is an admin", () => {
    const summary = makeSummary({
      visibility: "closed",
      callerIsActiveMember: false,
    });
    const entry = toRoomListEntryDto(summary, ADMIN);
    expect(entry.restricted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toRoomListEntryDto — private rooms
// ---------------------------------------------------------------------------

describe("toRoomListEntryDto — private rooms", () => {
  it("returns a full entry for a private room when the caller is an active member", () => {
    const summary = makeSummary({
      visibility: "private",
      callerIsActiveMember: true,
    });
    const entry = toRoomListEntryDto(summary, MEMBER);
    expect(entry.restricted).toBe(false);
  });

  it("returns a full entry for a private room when the caller is the owner", () => {
    const summary = makeSummary({
      visibility: "private",
      callerIsActiveMember: false,
    });
    const entry = toRoomListEntryDto(summary, OWNER);
    expect(entry.restricted).toBe(false);
  });

  it("returns a full entry for a private room when the caller is an admin", () => {
    const summary = makeSummary({
      visibility: "private",
      callerIsActiveMember: false,
    });
    const entry = toRoomListEntryDto(summary, ADMIN);
    expect(entry.restricted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toRoomListEntryDto — pendingCount badge
// ---------------------------------------------------------------------------

describe("toRoomListEntryDto — pendingCount badge", () => {
  it("includes pendingCount for the room owner", () => {
    const summary = makeSummary({ pendingCount: 5, callerIsActiveMember: true });
    const entry = toRoomListEntryDto(summary, OWNER);
    if (entry.restricted) throw new Error("expected non-restricted");
    expect(entry.pendingCount).toBe(5);
  });

  it("includes pendingCount for an admin", () => {
    const summary = makeSummary({ pendingCount: 2, callerIsActiveMember: false });
    const entry = toRoomListEntryDto(summary, ADMIN);
    if (entry.restricted) throw new Error("expected non-restricted");
    expect(entry.pendingCount).toBe(2);
  });

  it("does not include pendingCount for a non-owner member", () => {
    const summary = makeSummary({
      pendingCount: 3,
      callerIsActiveMember: true,
      createdByUserId: "someone-else",
    });
    const entry = toRoomListEntryDto(summary, MEMBER);
    if (entry.restricted) throw new Error("expected non-restricted");
    expect(entry).not.toHaveProperty("pendingCount");
  });

  it("does not include pendingCount when it is 0 and caller is not owner", () => {
    const summary = makeSummary({
      pendingCount: 0,
      callerIsActiveMember: true,
      createdByUserId: "someone-else",
    });
    const entry = toRoomListEntryDto(summary, MEMBER);
    if (entry.restricted) throw new Error("expected non-restricted");
    expect(entry).not.toHaveProperty("pendingCount");
  });
});

