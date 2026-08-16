import type { RoomVisibility, SimulationScope, SimulationStatus } from "@brickr/shared";
import { Prisma, type Db } from "../persistence/prisma.js";
import { optionalField } from "../persistence/repository-mapping.js";
import { toPost, type PostRow } from "../posts/post-repository.js";
import type { Post } from "../posts/post.js";
import { toSimulationScope, toSimulationStatus, toSimulationVisibility } from "../simulation/simulation-repository.js";
import type { FeedCursor } from "./feed-cursor.js";

/**
 * The room columns the feed needs: enough for its label and its capabilities.
 *
 * `createdByUserId` is absent rather than null for an unowned room, matching the
 * `Simulation` domain model so both go through the same ownership check.
 */
export type FeedRoom = {
  id: string;
  title: string | null;
  status: SimulationStatus;
  scope: SimulationScope;
  visibility: RoomVisibility;
  createdByUserId?: string;
};

export type FeedThreadRow = {
  root: Post;
  room: FeedRoom;
};

/** Identifies the reader for `filter=mine`; the handle is needed for mentions (§12.3). */
export type FeedMineScope = {
  userId: string;
  handle: string;
};

export type FeedPageQuery = {
  /** One room, or every simulation when the unified feed asks (§10.1). */
  simulationId?: string;
  mine?: FeedMineScope;
  cursor?: FeedCursor;
  /**
   * Rows to read. Callers ask for one more than they show, so "is there a next
   * page" is answered without a second count query.
   */
  limit: number;
  /**
   * When set, restricts the global feed to posts from these rooms only.
   *
   * Used by the unified feed to filter out closed/private rooms the reader
   * cannot see (§10.1). Absent for a room-scoped feed, which already narrows
   * by `simulationId`.
   */
  visibleRoomIds?: string[];
};

const ROOM_SELECT = {
  id: true,
  title: true,
  status: true,
  scope: true,
  visibility: true,
  createdByUserId: true,
} as const;

/**
 * Reads for the feed.
 *
 * The rule that shapes every method here: no query may be issued per thread
 * (§10.1, §26). A page costs a fixed number of round trips whether it holds one
 * thread or twenty — roots, reply counts, previewed replies, and for `mine` the
 * two id lookups it needs.
 */
export class FeedRepository {
  constructor(private readonly db: Db) {}

  /**
   * One page of thread roots, newest activity first, with the room each belongs to.
   *
   * Stopped rooms are included on purpose: stopping a room means "readable, not
   * writable", so removing its history from the feed would make stopping look
   * like deleting (§10.1).
   */
  async findThreadPage(query: FeedPageQuery): Promise<FeedThreadRow[]> {
    const conditions: Prisma.PostWhereInput[] = [];

    if (query.cursor) conditions.push(afterCursor(query.cursor));
    if (query.mine) {
      conditions.push(await this.concerningUser(query.mine, query.simulationId));
    }
    // Restrict the global feed to rooms the reader may see (§10.1). When
    // `visibleRoomIds` is present the caller has already resolved which rooms
    // are accessible; we push the list into the WHERE clause so the database
    // does the filtering rather than the application layer.
    if (query.visibleRoomIds !== undefined) {
      conditions.push({ roomId: { in: query.visibleRoomIds } });
    }

    const rows = await this.db.post.findMany({
      where: {
        // A thread is identified by its root, so the feed reads roots only.
        replyTo: null,
        ...(query.simulationId ? { roomId: query.simulationId } : {}),
        ...(conditions.length > 0 ? { AND: conditions } : {}),
      },
      include: { room: { select: ROOM_SELECT } },
      orderBy: [{ threadActivityAt: "desc" }, { id: "desc" }],
      take: query.limit,
    });

    return rows.map((row) => ({
      root: toPost(row),
      room: {
        id: row.room.id,
        title: row.room.title,
        status: toSimulationStatus(row.room.status),
        scope: toSimulationScope(row.room.scope),
        visibility: toSimulationVisibility(row.room.visibility),
        ...optionalField("createdByUserId", row.room.createdByUserId),
      },
    }));
  }

  /** Transitive reply totals for a page of threads, in one grouped query. */
  async countRepliesByThread(rootIds: string[]): Promise<Map<string, number>> {
    if (rootIds.length === 0) return new Map();

    const rows = await this.db.post.groupBy({
      by: ["threadRootId"],
      where: { threadRootId: { in: rootIds }, replyTo: { not: null } },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.threadRootId, row._count._all]));
  }

  /**
   * The newest `perThread` replies of each thread, oldest first.
   *
   * This is the one place raw SQL earns its keep (§10.1): "top N rows per group"
   * has no Prisma expression, and the alternatives are a query per thread — the
   * thing that is forbidden — or reading every reply of twenty threads to throw
   * almost all of them away.
   *
   * Columns are aliased to their domain names so the rows go through the same
   * mapper as every other post read.
   */
  async findLatestRepliesByThread(rootIds: string[], perThread: number): Promise<Post[]> {
    if (rootIds.length === 0) return [];

    const rows = await this.db.$queryRaw<PostRow[]>(Prisma.sql`
      SELECT ranked.id,
             ranked.room_id AS "roomId",
             ranked.author_id AS "authorId",
             ranked.content,
             ranked.image_url AS "imageUrl",
             ranked.mentions,
             ranked.reply_to AS "replyTo",
             ranked.quote_of AS "quoteOf",
             ranked.thread_root_id AS "threadRootId",
             ranked.thread_activity_at AS "threadActivityAt",
             ranked.created_at AS "createdAt"
      FROM (
        SELECT p.*,
               row_number() OVER (
                 PARTITION BY p.thread_root_id
                 ORDER BY p.created_at DESC, p.id DESC
               ) AS reply_rank
        FROM posts p
        WHERE p.thread_root_id IN (${Prisma.join(rootIds)})
          AND p.reply_to IS NOT NULL
      ) ranked
      WHERE ranked.reply_rank <= ${perThread}
      ORDER BY ranked.created_at ASC, ranked.id ASC
    `);

    return rows.map(toPost);
  }

  /**
   * The single newest reply per thread that concerns this reader - answers
   * them or mentions them - regardless of whether it is among that thread's
   * top `REPLY_PREVIEW_COUNT` most-recent replies (§12.3).
   *
   * Same "top N per group" shape as `findLatestRepliesByThread`, but ranked
   * by a concern condition instead of plain recency, and capped at one per
   * thread: the caller only needs this to backfill a preview the reply would
   * otherwise have been pushed out of by newer, unrelated replies, not a
   * second full preview list.
   */
  async findConcerningReplyByThread(
    rootIds: string[],
    mine: FeedMineScope,
  ): Promise<Map<string, Post>> {
    if (rootIds.length === 0) return new Map();

    const rows = await this.db.$queryRaw<PostRow[]>(Prisma.sql`
      SELECT ranked.id,
             ranked.room_id AS "roomId",
             ranked.author_id AS "authorId",
             ranked.content,
             ranked.image_url AS "imageUrl",
             ranked.mentions,
             ranked.reply_to AS "replyTo",
             ranked.quote_of AS "quoteOf",
             ranked.thread_root_id AS "threadRootId",
             ranked.thread_activity_at AS "threadActivityAt",
             ranked.created_at AS "createdAt"
      FROM (
        SELECT p.*,
               row_number() OVER (
                 PARTITION BY p.thread_root_id
                 ORDER BY p.created_at DESC, p.id DESC
               ) AS concern_rank
        FROM posts p
        LEFT JOIN posts parent ON parent.id = p.reply_to
        WHERE p.thread_root_id IN (${Prisma.join(rootIds)})
          AND p.reply_to IS NOT NULL
          AND (parent.author_id = ${mine.userId} OR ${mine.handle} = ANY(p.mentions))
      ) ranked
      WHERE ranked.concern_rank = 1
    `);

    return new Map(rows.map((row) => [row.threadRootId, toPost(row)]));
  }

  /**
   * The IDs of every room whose posts may appear in the global feed for this
   * reader (§10.1).
   *
   * Visibility rules:
   * - `public` and `open` rooms are visible to everyone, including anonymous
   *   readers.
   * - `closed` and `private` rooms are visible only to their active members
   *   (and to the room owner, who always holds an active owner membership).
   * - Archived rooms follow the same visibility rules as active ones for the
   *   global feed: stopping a room means "readable, not writable", so its
   *   history stays in the feed for everyone who could see it before (§10.1).
   *
   * The global simulation row itself is always included — it is the feed, and
   * its posts are visible to everyone.
   *
   * One query regardless of how many rooms exist: the database filters by
   * visibility and membership in a single pass.
   */
  async findVisibleRoomIds(userId: string | null, isAdmin = false): Promise<string[]> {
    if (isAdmin) {
      const rows = await this.db.room.findMany({ select: { id: true } });
      return rows.map((row: { id: string }) => row.id);
    }

    const memberOnlyRooms: Prisma.RoomWhereInput[] =
      userId !== null
        ? [
            {
              visibility: { in: ["closed", "private"] },
              memberships: {
                some: {
                  memberId: userId,
                  memberKind: "user",
                  status: "active",
                },
              },
            },
          ]
        : [];

    const rows = await this.db.room.findMany({
      where: {
        OR: [
          // public and open rooms are visible to everyone.
          { visibility: { in: ["public", "open"] } },
          // The global simulation row is always visible.
          { scope: "global" },
          // closed and private rooms: only active members (including the owner,
          // who always holds an active owner membership).
          ...memberOnlyRooms,
        ],
      },
      select: { id: true },
    });

    return rows.map((row: { id: string }) => row.id);
  }

  /** Whether one user has an active membership in one specific room. */
  async hasActiveRoomMembership(roomId: string, userId: string): Promise<boolean> {
    const room = await this.db.room.findFirst({
      where: {
        id: roomId,
        memberships: {
          some: {
            memberId: userId,
            memberKind: "user",
            status: "active",
          },
        },
      },
      select: { id: true },
    });

    return room !== null;
  }

  /**
   * Every reply in one thread, oldest first (§12.2).
   *
   * `threadRootId` is what makes this a single indexed read instead of walking
   * `replyTo` level by level — the reason it is denormalised (§8.3).
   */
  async findThreadReplies(threadRootId: string, limit: number): Promise<Post[]> {
    const rows = await this.db.post.findMany({
      where: { threadRootId, replyTo: { not: null } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit,
    });
    return rows.map(toPost);
  }

  /**
   * The `mine` filter as a root condition (§12.3).
   *
   * The first two OR arms below (`authorId`/`mentions`) are properties of the
   * root itself. Everything else cannot be: "a reply in this thread answers a
   * post of mine", "a reply mentions me", and "this root quotes a post of
   * mine" are all facts about other rows relative to the root (a reply, or —
   * for the quote arm — the root row itself referencing a different post via
   * `quoteOf`), and `threadRootId` has no Prisma relation to join through
   * (§8.3), so the qualifying thread ids are collected first and matched by id.
   *
   * Three queries regardless of page size, and none of them per thread.
   *
   * A room-scoped caller narrows every lookup to that room as well. It changes no
   * result — a thread never spans simulations, since a reply is refused unless its
   * target belongs to the same one (§10.5) — but without it one room's "自分あて"
   * would read every reply, mention, and quote in the database to build a list
   * that the outer query then throws away (§26).
   */
  private async concerningUser(
    mine: FeedMineScope,
    simulationId?: string,
  ): Promise<Prisma.PostWhereInput> {
    const room = simulationId === undefined ? {} : { roomId: simulationId };

    const [answered, mentioned, quoted] = await Promise.all([
      // A reply whose parent I wrote. Having merely posted in the thread does
      // not count, or `mine` would collapse into `all`.
      this.db.post.findMany({
        where: { ...room, replyTo: { not: null }, replyToPost: { authorId: mine.userId } },
        select: { threadRootId: true },
        distinct: ["threadRootId"],
      }),
      this.db.post.findMany({
        where: { ...room, mentions: { has: mine.handle } },
        select: { threadRootId: true },
        distinct: ["threadRootId"],
      }),
      // A quote repost of a post of mine. Always its own root thread (§8.3,
      // §12.1), so this is a fact about the root itself - but it still needs
      // the same "collect ids, then match by id" shape as the reply arm above,
      // since `findThreadPage`'s own query has no relation to join through
      // for `quoteOfPost` any more cheaply than this.
      this.db.post.findMany({
        where: { ...room, quoteOf: { not: null }, quoteOfPost: { authorId: mine.userId } },
        select: { threadRootId: true },
        distinct: ["threadRootId"],
      }),
    ]);

    const threadIds = [
      ...new Set([...answered, ...mentioned, ...quoted].map((row) => row.threadRootId)),
    ];

    return {
      OR: [
        { authorId: mine.userId },
        { mentions: { has: mine.handle } },
        ...(threadIds.length > 0 ? [{ id: { in: threadIds } }] : []),
      ],
    };
  }
}

/**
 * The next page starts strictly after the cursor in `(threadActivityAt, id)`
 * order, which is why the id comparison exists: without it, threads sharing a
 * timestamp with the cursor would be served twice or not at all (§9.4).
 */
function afterCursor(cursor: FeedCursor): Prisma.PostWhereInput {
  return {
    OR: [
      { threadActivityAt: { lt: cursor.activityAt } },
      { threadActivityAt: cursor.activityAt, id: { lt: cursor.id } },
    ],
  };
}
