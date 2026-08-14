import { Prisma, type Db } from "../persistence/prisma.js";
import { toPost } from "../posts/post-repository.js";
import type { Post } from "../posts/post.js";
// The profile list pages the same way the feed does, so it reuses the feed's
// cursor rather than introducing a second opaque format with the same job (§9.4).
import type { FeedCursor } from "../feed/feed-cursor.js";

/**
 * Who is asking, which decides how much of an account's history they may read
 * (§10.6).
 *
 * Login is required to reach a profile at all, so there is no anonymous variant
 * of this type: an unauthenticated caller never gets this far.
 */
export type ProfileViewer = {
  id: string;
  isAdmin: boolean;
};

/**
 * Reads one account's posts, across every room.
 *
 * The visibility rule lives here, in the `where` clause, rather than being
 * applied to the rows afterwards: a page of 20 that then drops the posts the
 * caller may not see would return short pages and eventually an empty one that
 * looks like the end of the list.
 */
export class ProfileRepository {
  constructor(private readonly db: Db) {}

  /**
   * One page of an account's posts, newest first (§10.6).
   *
   * Ordered by `(createdAt, id)` for the same reason the feed orders by
   * `(threadActivityAt, id)`: two posts can share a millisecond, and a page
   * boundary between them would repeat or drop one (§9.4).
   */
  async findPostsByAuthor(input: {
    authorId: string;
    viewer: ProfileViewer;
    cursor?: FeedCursor;
    limit: number;
  }): Promise<Post[]> {
    const rows = await this.db.post.findMany({
      where: {
        authorId: input.authorId,
        ...visibleRooms(input.viewer),
        ...(input.cursor ? afterCursor(input.cursor) : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit,
    });
    return rows.map(toPost);
  }

  /**
   * How many posts this viewer may see from this account.
   *
   * Counted under the same condition as the list, so the number on the profile
   * cannot promise posts the list below it never shows (§10.6).
   */
  async countPostsByAuthor(authorId: string, viewer: ProfileViewer): Promise<number> {
    return this.db.post.count({
      where: { authorId, ...visibleRooms(viewer) },
    });
  }
}

/**
 * Posts from stopped rooms are hidden from everybody except that room's creator
 * and an administrator (§10.6).
 *
 * The unified feed is deliberately the *only* place a stopped room's history
 * stays visible to everyone (§10.1). Repeating that exception on the profile
 * would spread it across surfaces until "stopped" stopped meaning anything.
 */
function visibleRooms(viewer: ProfileViewer): Prisma.PostWhereInput {
  if (viewer.isAdmin) return {};
  return {
    simulation: {
      OR: [{ status: "active" }, { createdByUserId: viewer.id }],
    },
  };
}

/** Strictly after the cursor in `(createdAt, id)` order - see `findPostsByAuthor`. */
function afterCursor(cursor: FeedCursor): Prisma.PostWhereInput {
  return {
    OR: [
      { createdAt: { lt: cursor.activityAt } },
      { createdAt: cursor.activityAt, id: { lt: cursor.id } },
    ],
  };
}
