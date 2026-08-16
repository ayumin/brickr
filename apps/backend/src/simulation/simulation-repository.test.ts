import { describe, expect, it, vi } from "vitest";
import type { Db } from "../persistence/prisma.js";
import { SimulationRepository } from "./simulation-repository.js";

const ADMIN = { id: "admin-1", isAdmin: true };
const USER = { id: "user-1", isAdmin: false };

function makeDb(rows: unknown[]) {
  const findMany = vi.fn((_args: unknown) => Promise.resolve(rows));
  return { db: { room: { findMany } } as unknown as Db, findMany };
}

function firstFindManyArgs(findMany: ReturnType<typeof makeDb>["findMany"]): unknown {
  const call = findMany.mock.calls.at(0);
  if (!call) throw new Error("Expected room.findMany to have been called");
  return call[0];
}

// Helper to build a minimal room row for findAllVisibleTo tests.
function makeRoomRow(overrides: Record<string, unknown> = {}) {
  const createdAt = new Date("2026-08-10T01:02:03.000Z");
  return {
    id: "simulation-1",
    title: "テスト",
    status: "active",
    scope: "room",
    visibility: "public",
    createdAt,
    updatedAt: createdAt,
    lastActivityAt: createdAt,
    createdByUserId: "user-1",
    _count: { posts: 0, memberships: 0 },
    createdByUser: null,
    memberships: [],
    ...overrides,
  };
}

describe("SimulationRepository.findAllVisibleTo", () => {
  it("orders by activity and maps post counts and the creator", async () => {
    const createdAt = new Date("2026-08-10T01:02:03.000Z");
    const lastActivityAt = new Date("2026-08-12T09:00:00.000Z");
    const { db } = makeDb([
      {
        id: "simulation-1",
        title: "履歴",
        status: "active",
        scope: "room",
        visibility: "public",
        tags: ["history"],
        createdAt,
        updatedAt: createdAt,
        lastActivityAt,
        createdByUserId: "user-1",
        _count: { posts: 42, memberships: 0 },
        createdByUser: { id: "user-1", handle: "hanako", displayName: "花子" },
        memberships: [],
      },
    ]);

    const [summary] = await new SimulationRepository(db).findAllVisibleTo(USER);

    // Core fields are mapped correctly.
    expect(summary).toMatchObject({
      id: "simulation-1",
      title: "履歴",
      status: "active",
      scope: "room",
      createdAt,
      lastActivityAt,
      createdByUserId: "user-1",
      postCount: 42,
      creator: { id: "user-1", handle: "hanako", displayName: "花子" },
    });
  });

  it("uses AND to combine the status and visibility conditions for a regular user", async () => {
    const { db, findMany } = makeDb([]);

    await new SimulationRepository(db).findAllVisibleTo(USER);

    // Rooms only, because the reserved global row is the feed itself rather than
    // an entry in the room list (§8.2). Activity order, not creation order, so an
    // active room cannot sink out of reach (§10.3).
    // The AND clause combines: (1) archived-room ownership and (2) visibility.
    const call = firstFindManyArgs(findMany);
    expect(call).toHaveProperty("where.scope", "room");
    expect(call).toHaveProperty("where.AND");
    expect(call).toHaveProperty("orderBy", [
      { lastActivityAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("asks the database for only the stopped rooms an ordinary caller owns", async () => {
    const { db, findMany } = makeDb([]);

    await new SimulationRepository(db).findAllVisibleTo(USER);

    // Filtered in the query rather than afterwards: a room this caller may not
    // see is never read, so it cannot leak through a mapping mistake later.
    const call = firstFindManyArgs(findMany);
    expect(call).toHaveProperty(
      "where.AND.0.OR",
      expect.arrayContaining([{ status: "active" }, { createdByUserId: USER.id }]),
    );
  });

  it("includes public/open/closed rooms for a regular user (visibility clause)", async () => {
    const { db, findMany } = makeDb([]);

    await new SimulationRepository(db).findAllVisibleTo(USER);

    const call = firstFindManyArgs(findMany);
    // public, open, closed are discoverable by all authenticated users
    expect(call).toHaveProperty(
      "where.AND.1.OR.0.visibility.in",
      expect.arrayContaining(["public", "open", "closed"]),
    );
  });

  it("allows private rooms for their creator or an active member", async () => {
    const { db, findMany } = makeDb([]);

    await new SimulationRepository(db).findAllVisibleTo(USER);

    const call = firstFindManyArgs(findMany);
    expect(call).toHaveProperty("where.AND.1.OR.1.visibility", "private");
    expect(call).toHaveProperty(
      "where.AND.1.OR.1.OR",
      expect.arrayContaining([
        { createdByUserId: USER.id },
        {
          memberships: {
            some: { memberId: USER.id, memberKind: "user", status: "active" },
          },
        },
      ]),
    );
  });

  it("puts no status or visibility condition on an administrator's list", async () => {
    const { db, findMany } = makeDb([]);

    await new SimulationRepository(db).findAllVisibleTo(ADMIN);

    const call = firstFindManyArgs(findMany);
    // Admin query has no AND clause — just scope: "room"
    expect(call).toHaveProperty("where", { scope: "room" });
  });

  it("includes pending membership count in the _count select", async () => {
    const { db, findMany } = makeDb([]);

    await new SimulationRepository(db).findAllVisibleTo(USER);

    const call = firstFindManyArgs(findMany);
    expect(call).toHaveProperty("include._count.select.memberships", {
      where: { status: "pending" },
    });
  });

  it("includes the caller's own membership in the include clause", async () => {
    const { db, findMany } = makeDb([]);

    await new SimulationRepository(db).findAllVisibleTo(USER);

    const call = firstFindManyArgs(findMany);
    expect(call).toHaveProperty("include.memberships.where", {
      memberId: USER.id,
      memberKind: "user",
    });
  });

  it("maps pendingCount and callerIsActiveMember from the row", async () => {
    const createdAt = new Date("2026-08-16T00:00:00.000Z");
    const { db } = makeDb([
      makeRoomRow({
        id: "room-1",
        visibility: "open",
        createdAt,
        lastActivityAt: createdAt,
        createdByUserId: "user-owner",
        _count: { posts: 2, memberships: 3 },
        createdByUser: { id: "user-owner", handle: "owner", displayName: "オーナー" },
        memberships: [{ status: "active" }],
      }),
    ]);

    const [summary] = await new SimulationRepository(db).findAllVisibleTo(USER);

    expect(summary?.pendingCount).toBe(3);
    expect(summary?.callerIsActiveMember).toBe(true);
  });

  it("sets callerIsActiveMember to false when the caller has no membership", async () => {
    const createdAt = new Date("2026-08-16T00:00:00.000Z");
    const { db } = makeDb([
      makeRoomRow({
        id: "room-2",
        visibility: "public",
        createdAt,
        lastActivityAt: createdAt,
        createdByUserId: "user-owner",
        _count: { posts: 0, memberships: 0 },
        createdByUser: null,
        memberships: [],
      }),
    ]);

    const [summary] = await new SimulationRepository(db).findAllVisibleTo(USER);

    expect(summary?.callerIsActiveMember).toBe(false);
  });

  it("reports a room with no owner as having no creator", async () => {
    const createdAt = new Date("2026-08-10T01:02:03.000Z");
    const { db } = makeDb([
      makeRoomRow({
        id: "simulation-2",
        title: null,
        tags: [],
        createdAt,
        lastActivityAt: createdAt,
        createdByUserId: null,
        _count: { posts: 0, memberships: 0 },
        createdByUser: null,
        memberships: [],
      }),
    ]);

    const [summary] = await new SimulationRepository(db).findAllVisibleTo(ADMIN);

    expect(summary?.creator).toBeNull();
    expect(summary).not.toHaveProperty("createdByUserId");
  });

  it("falls back to a handle derived from the id when a creator has none", async () => {
    const createdAt = new Date("2026-08-10T01:02:03.000Z");
    const { db } = makeDb([
      makeRoomRow({
        id: "simulation-3",
        title: "旧アカウント",
        tags: [],
        createdAt,
        lastActivityAt: createdAt,
        createdByUserId: "0191d3f0-0000-4000-8000-000000000abc",
        _count: { posts: 1, memberships: 0 },
        createdByUser: {
          id: "0191d3f0-0000-4000-8000-000000000abc",
          handle: null,
          displayName: "名前だけの人",
        },
        memberships: [],
      }),
    ]);

    const [summary] = await new SimulationRepository(db).findAllVisibleTo(ADMIN);

    // The same fallback the profile repository applies, rather than a second one
    // that could disagree with it.
    expect(summary?.creator?.handle).toBe("0191d3f0000040008000000000000abc");
  });
});

describe("SimulationRepository.archiveByIds", () => {
  it("archives only active room-scoped rows in the membership-derived id set", async () => {
    const updateMany = vi.fn(() => Promise.resolve({ count: 2 }));
    const db = { room: { updateMany } } as unknown as Db;

    await new SimulationRepository(db).archiveByIds(["room-transferred", "room-created"]);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["room-transferred", "room-created"] },
        status: "active",
        scope: "room",
      },
      data: { status: "archived" },
    });
  });
});
