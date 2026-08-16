import { describe, expect, it, vi } from "vitest";
import type { Db } from "../persistence/prisma.js";
import { ProfileRepository } from "./profile-repository.js";

/**
 * What matters here is the `where` clause. The visibility rule is expressed as a
 * query condition rather than applied to the rows afterwards (§10.6), so this is
 * the level at which it can be pinned: a page of 20 that dropped rows after
 * reading them would return short pages and eventually a false end of list.
 */
const VIEWER = { id: "user-1", isAdmin: false };
const ADMIN = { id: "admin-1", isAdmin: true };

function makeDb() {
  const findMany = vi.fn(() => Promise.resolve([]));
  const count = vi.fn(() => Promise.resolve(0));
  return { db: { post: { findMany, count } } as unknown as Db, findMany, count };
}

describe("ProfileRepository.findPostsByAuthor", () => {
  it("reads one account's posts newest first, hiding stopped rooms it may not see", async () => {
    const { db, findMany } = makeDb();

    await new ProfileRepository(db).findPostsByAuthor({
      authorId: "author-1",
      viewer: VIEWER,
      limit: 21,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        authorId: "author-1",
        room: { OR: [{ status: "active" }, { createdByUserId: VIEWER.id }] },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 21,
    });
  });

  it("puts no room condition on an administrator's read", async () => {
    const { db, findMany } = makeDb();

    await new ProfileRepository(db).findPostsByAuthor({
      authorId: "author-1",
      viewer: ADMIN,
      limit: 21,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { authorId: "author-1" } }),
    );
  });

  it("continues strictly after the cursor, using the id to break a shared timestamp", async () => {
    const { db, findMany } = makeDb();
    const activityAt = new Date("2026-08-13T10:00:00.000Z");

    await new ProfileRepository(db).findPostsByAuthor({
      authorId: "author-1",
      viewer: ADMIN,
      cursor: { activityAt, id: "post-9" },
      limit: 21,
    });

    // Without the id comparison, posts sharing a timestamp with the cursor would
    // be served twice or skipped entirely (§9.4).
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          authorId: "author-1",
          OR: [{ createdAt: { lt: activityAt } }, { createdAt: activityAt, id: { lt: "post-9" } }],
        },
      }),
    );
  });
});

describe("ProfileRepository.countPostsByAuthor", () => {
  it("counts under the same condition as the list, so the two cannot disagree", async () => {
    const { db, count } = makeDb();

    await new ProfileRepository(db).countPostsByAuthor("author-1", VIEWER);

    expect(count).toHaveBeenCalledWith({
      where: {
        authorId: "author-1",
        room: { OR: [{ status: "active" }, { createdByUserId: VIEWER.id }] },
      },
    });
  });
});
