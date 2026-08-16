import { describe, expect, it, vi } from "vitest";
import type { Db } from "../persistence/prisma.js";
import { SimulationRepository } from "./simulation-repository.js";

const ADMIN = { id: "admin-1", isAdmin: true };
const USER = { id: "user-1", isAdmin: false };

function makeDb(rows: unknown[]) {
  const findMany = vi.fn(() => Promise.resolve(rows));
  return { db: { room: { findMany } } as unknown as Db, findMany };
}

describe("SimulationRepository.findAllVisibleTo", () => {
  it("orders by activity and maps post counts and the creator", async () => {
    const createdAt = new Date("2026-08-10T01:02:03.000Z");
    const lastActivityAt = new Date("2026-08-12T09:00:00.000Z");
    const { db, findMany } = makeDb([
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
        _count: { posts: 42 },
        createdByUser: { id: "user-1", handle: "hanako", displayName: "花子" },
      },
    ]);

    await expect(new SimulationRepository(db).findAllVisibleTo(USER)).resolves.toEqual([
      {
        id: "simulation-1",
        title: "履歴",
        status: "active",
        scope: "room",
        visibility: "public",
        tags: ["history"],
        createdAt,
        lastActivityAt,
        createdByUserId: "user-1",
        postCount: 42,
        creator: { id: "user-1", handle: "hanako", displayName: "花子" },
      },
    ]);
    // Rooms only, because the reserved global row is the feed itself rather than
    // an entry in the room list (§8.2). Activity order, not creation order, so an
    // active room cannot sink out of reach (§10.3).
    expect(findMany).toHaveBeenCalledWith({
      where: {
        scope: "room",
        OR: [{ status: "active" }, { createdByUserId: USER.id }],
      },
      include: {
        _count: { select: { posts: true } },
        createdByUser: { select: { id: true, handle: true, displayName: true } },
      },
      orderBy: [{ lastActivityAt: "desc" }, { id: "desc" }],
    });
  });

  it("asks the database for only the stopped rooms an ordinary caller owns", async () => {
    const { db, findMany } = makeDb([]);

    await new SimulationRepository(db).findAllVisibleTo(USER);

    // Filtered in the query rather than afterwards: a room this caller may not
    // see is never read, so it cannot leak through a mapping mistake later.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          scope: "room",
          OR: [{ status: "active" }, { createdByUserId: USER.id }],
        },
      }),
    );
  });

  it("puts no status condition on an administrator's list", async () => {
    const { db, findMany } = makeDb([]);

    await new SimulationRepository(db).findAllVisibleTo(ADMIN);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { scope: "room" } }),
    );
  });

  it("reports a room with no owner as having no creator", async () => {
    const createdAt = new Date("2026-08-10T01:02:03.000Z");
    const { db } = makeDb([
      {
        id: "simulation-2",
        title: null,
        status: "active",
        scope: "room",
        visibility: "public",
        tags: [],
        createdAt,
        updatedAt: createdAt,
        lastActivityAt: createdAt,
        createdByUserId: null,
        _count: { posts: 0 },
        createdByUser: null,
      },
    ]);

    const [summary] = await new SimulationRepository(db).findAllVisibleTo(ADMIN);

    expect(summary?.creator).toBeNull();
    expect(summary).not.toHaveProperty("createdByUserId");
  });

  it("falls back to a handle derived from the id when a creator has none", async () => {
    const createdAt = new Date("2026-08-10T01:02:03.000Z");
    const { db } = makeDb([
      {
        id: "simulation-3",
        title: "旧アカウント",
        status: "active",
        scope: "room",
        visibility: "public",
        tags: [],
        createdAt,
        updatedAt: createdAt,
        lastActivityAt: createdAt,
        createdByUserId: "0191d3f0-0000-4000-8000-000000000abc",
        _count: { posts: 1 },
        createdByUser: {
          id: "0191d3f0-0000-4000-8000-000000000abc",
          handle: null,
          displayName: "名前だけの人",
        },
      },
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
