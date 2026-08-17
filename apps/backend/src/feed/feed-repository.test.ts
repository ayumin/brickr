import { describe, expect, it, vi } from "vitest";
import type { Db } from "../persistence/prisma.js";
import { FeedRepository } from "./feed-repository.js";

type FindManyArgs = {
  where: Record<string, unknown>;
  include?: unknown;
  select?: unknown;
  orderBy?: unknown;
  take?: number;
  distinct?: unknown;
};

const ROOM_ROW = {
  id: "room-1",
  title: "設計の部屋",
  status: "active",
  visibility: "public",
  createdByUserId: "owner-1",
};

function postRow(overrides: Record<string, unknown> = {}) {
  const createdAt = new Date("2026-08-13T10:00:00.000Z");
  return {
    id: "root-1",
    roomId: "room-1",
    authorId: "author-1",
    content: "本文",
    imageUrl: null,
    mentions: [],
    replyTo: null,
    quoteOf: null,
    threadRootId: "root-1",
    threadActivityAt: createdAt,
    createdAt,
    ...overrides,
  };
}

/**
 * The Prisma client, mocked by intent: each `findMany` answers according to what
 * it was asked for, so adding a query cannot silently rewire an existing
 * assertion.
 */
function makeDb(options: {
  roots?: Record<string, unknown>[];
  threadIds?: string[];
  visibleRooms?: Array<{ id: string }>;
} = {}) {
  const calls: FindManyArgs[] = [];

  const db = {
    post: {
      findMany: vi.fn((args: FindManyArgs) => {
        calls.push(args);
        if (args.distinct) {
          return Promise.resolve((options.threadIds ?? []).map((id) => ({ threadRootId: id })));
        }
        if (args.include) {
          return Promise.resolve(
            (options.roots ?? [postRow()]).map((root) => ({ ...root, room: ROOM_ROW })),
          );
        }
        return Promise.resolve(options.roots ?? []);
      }),
      groupBy: vi.fn(() =>
        Promise.resolve([{ threadRootId: "root-1", _count: { _all: 3 } }]),
      ),
    },
    room: {
      findMany: vi.fn(() =>
        Promise.resolve(options.visibleRooms ?? [{ id: "room-1" }]),
      ),
      findFirst: vi.fn<() => Promise<{ id: string } | null>>(() => Promise.resolve(null)),
    },
    // Typed with the parts of a Prisma statement the assertions below read.
    $queryRaw: vi.fn((_statement: { sql: string; values: unknown[] }) =>
      Promise.resolve([postRow({ id: "reply-1", replyTo: "root-1" })]),
    ),
  };

  return { db: db as unknown as Db, spies: db, calls };
}

describe("FeedRepository.findThreadPage (§10.1)", () => {
  it("reads roots only, newest activity first, with the id as the tiebreaker", async () => {
    const { db, calls } = makeDb();

    await new FeedRepository(db).findThreadPage({ limit: 21 });

    expect(calls[0]?.where).toMatchObject({ replyTo: null });
    expect(calls[0]?.orderBy).toEqual([{ threadActivityAt: "desc" }, { id: "desc" }]);
    expect(calls[0]?.take).toBe(21);
  });

  /** One query brings the room along, so labelling a page costs no extra round trip. */
  it("loads each thread's room in the same query", async () => {
    const { db, calls } = makeDb();

    const rows = await new FeedRepository(db).findThreadPage({ limit: 21 });

    expect(calls[0]?.include).toEqual({
      room: {
        select: {
          id: true,
          title: true,
          status: true,
          visibility: true,
          createdByUserId: true,
        },
      },
    });
    expect(rows[0]?.room).toEqual({
      id: "room-1",
      title: "設計の部屋",
      status: "active",
      visibility: "public",
      createdByUserId: "owner-1",
    });
  });

  it("leaves an unowned room's creator absent rather than null", async () => {
    const { db } = makeDb();
    const repository = new FeedRepository(db);
    const spies = db as unknown as { post: { findMany: ReturnType<typeof vi.fn> } };
    spies.post.findMany.mockImplementationOnce(() =>
      Promise.resolve([{ ...postRow(), room: { ...ROOM_ROW, createdByUserId: null } }]),
    );

    const rows = await repository.findThreadPage({ limit: 21 });

    expect(rows[0]?.room).not.toHaveProperty("createdByUserId");
  });

  it("restricts to one room when asked", async () => {
    const { db, calls } = makeDb();

    await new FeedRepository(db).findThreadPage({ limit: 21, roomId: "room-1" });

    expect(calls[0]?.where).toMatchObject({ roomId: "room-1" });
  });

  /**
   * The cursor's id comparison is what makes paging exact when several threads
   * share a millisecond (§9.4).
   */
  it("continues strictly after the cursor, timestamp and id together", async () => {
    const { db, calls } = makeDb();
    const activityAt = new Date("2026-08-13T10:00:00.000Z");

    await new FeedRepository(db).findThreadPage({
      limit: 21,
      cursor: { activityAt, id: "root-5" },
    });

    expect(calls[0]?.where).toMatchObject({
      AND: [
        {
          OR: [
            { threadActivityAt: { lt: activityAt } },
            { threadActivityAt: activityAt, id: { lt: "root-5" } },
          ],
        },
      ],
    });
  });

  /**
   * The global feed restricts to rooms the reader can see (§10.1). The list is
   * computed by `findVisibleRoomIds` and pushed into the WHERE clause so the
   * database does the filtering.
   */
  it("restricts to visible rooms when visibleRoomIds is provided", async () => {
    const { db, calls } = makeDb();

    await new FeedRepository(db).findThreadPage({
      limit: 21,
      visibleRoomIds: ["room-1", "room-2"],
    });

    expect(calls[0]?.where).toMatchObject({
      AND: [{ roomId: { in: ["room-1", "room-2"] } }],
    });
  });
});

describe("FeedRepository.findVisibleRoomIds (§10.1)", () => {
  it("queries public and open rooms for any reader", async () => {
    const { db, spies } = makeDb({ visibleRooms: [{ id: "room-1" }, { id: "room-global" }] });

    const ids = await new FeedRepository(db).findVisibleRoomIds(null);

    expect(spies.room.findMany).toHaveBeenCalledTimes(1);
    const call = spies.room.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }];
    // Public and open rooms are always included.
    expect(call[0].where).toMatchObject({
      OR: expect.arrayContaining([{ visibility: { in: ["public", "open"] } }]),
    });
    expect(ids).toEqual(["room-1", "room-global"]);
  });

  it("includes closed and private rooms the signed-in reader is an active member of", async () => {
    const { db, spies } = makeDb({ visibleRooms: [{ id: "room-1" }, { id: "room-closed" }] });

    await new FeedRepository(db).findVisibleRoomIds("user-1");

    const call = spies.room.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }];
    // closed/private rooms with an active membership are included.
    expect(call[0].where).toMatchObject({
      OR: expect.arrayContaining([
        {
          visibility: { in: ["closed", "private"] },
          memberships: {
            some: {
              memberId: "user-1",
              memberKind: "user",
              status: "active",
            },
          },
        },
      ]),
    });
  });

  it("does not include closed/private membership arm for anonymous readers", async () => {
    const { db, spies } = makeDb({ visibleRooms: [{ id: "room-1" }] });

    await new FeedRepository(db).findVisibleRoomIds(null);

    const call = spies.room.findMany.mock.calls[0] as unknown as [{ where: { OR: unknown[] } }];
    // Only the public/open arm remains. There is no membership arm for anonymous readers.
    expect(call[0].where.OR).toHaveLength(1);
  });

  it("returns the room ids from the query result", async () => {
    const { db } = makeDb({ visibleRooms: [{ id: "room-a" }, { id: "room-b" }] });

    const ids = await new FeedRepository(db).findVisibleRoomIds("user-1");

    expect(ids).toEqual(["room-a", "room-b"]);
  });

  it("returns every room for an administrator without applying visibility filters", async () => {
    const { db, spies } = makeDb({ visibleRooms: [{ id: "room-private" }] });

    const ids = await new FeedRepository(db).findVisibleRoomIds("admin-1", true);

    expect(spies.room.findMany).toHaveBeenCalledWith({ select: { id: true } });
    expect(ids).toEqual(["room-private"]);
  });
});

describe("FeedRepository.hasActiveRoomMembership", () => {
  it("checks one room and one user's active membership", async () => {
    const { db, spies } = makeDb();
    spies.room.findFirst.mockResolvedValueOnce({ id: "room-closed" });

    await expect(
      new FeedRepository(db).hasActiveRoomMembership("room-closed", "user-1"),
    ).resolves.toBe(true);

    expect(spies.room.findFirst).toHaveBeenCalledWith({
      where: {
        id: "room-closed",
        memberships: {
          some: {
            memberId: "user-1",
            memberKind: "user",
            status: "active",
          },
        },
      },
      select: { id: true },
    });
  });
});

describe("FeedRepository mine filter (§12.3)", () => {
  it("collects the threads that concern the reader in three queries, not one per thread", async () => {
    const { db, calls, spies } = makeDb({ threadIds: ["root-7", "root-8"] });

    await new FeedRepository(db).findThreadPage({
      limit: 21,
      mine: { userId: "reader-1", handle: "hanako" },
    });

    const lookups = calls.filter((call) => call.distinct !== undefined);
    expect(lookups).toHaveLength(3);
    // A reply whose parent I wrote, any post that mentions me, and a quote
    // repost of a post of mine.
    expect(lookups[0]?.where).toMatchObject({ replyToPost: { authorId: "reader-1" } });
    expect(lookups[1]?.where).toMatchObject({ mentions: { has: "hanako" } });
    expect(lookups[2]?.where).toMatchObject({ quoteOfPost: { authorId: "reader-1" } });
    // The unified feed spans every room, so none of the lookups are narrowed.
    expect(lookups[0]?.where).not.toHaveProperty("roomId");
    expect(lookups[1]?.where).not.toHaveProperty("roomId");
    expect(lookups[2]?.where).not.toHaveProperty("roomId");
    // Four queries in total, whatever the page holds.
    expect(spies.post.findMany).toHaveBeenCalledTimes(4);
  });

  /**
   * A thread never spans simulations (§10.5), so narrowing the lookups changes no
   * result. It stops one room's filter from reading every reply, mention, and quote
   * in the database to build a list the outer query would discard anyway (§26).
   */
  it("narrows every lookup to the room when the caller asked for one", async () => {
    const { db, calls } = makeDb({ threadIds: ["root-7"] });

    await new FeedRepository(db).findThreadPage({
      limit: 21,
      roomId: "room-1",
      mine: { userId: "reader-1", handle: "hanako" },
    });

    const lookups = calls.filter((call) => call.distinct !== undefined);
    expect(lookups[0]?.where).toMatchObject({
      roomId: "room-1",
      replyToPost: { authorId: "reader-1" },
    });
    expect(lookups[1]?.where).toMatchObject({
      roomId: "room-1",
      mentions: { has: "hanako" },
    });
    expect(lookups[2]?.where).toMatchObject({
      roomId: "room-1",
      quoteOfPost: { authorId: "reader-1" },
    });
    // The roots keep both of their own conditions.
    const roots = calls.find((call) => call.include !== undefined);
    expect(roots?.where).toMatchObject({ replyTo: null, roomId: "room-1" });
    expect(roots?.where).toHaveProperty("AND");
  });

  it("matches roots I wrote, roots mentioning me, and the threads it collected", async () => {
    const { db, calls } = makeDb({ threadIds: ["root-7"] });

    await new FeedRepository(db).findThreadPage({
      limit: 21,
      mine: { userId: "reader-1", handle: "hanako" },
    });

    const roots = calls.find((call) => call.include !== undefined);
    expect(roots?.where).toMatchObject({
      AND: [
        {
          OR: [
            { authorId: "reader-1" },
            { mentions: { has: "hanako" } },
            { id: { in: ["root-7"] } },
          ],
        },
      ],
    });
  });

  it("omits the id arm when nothing else concerns the reader", async () => {
    const { db, calls } = makeDb({ threadIds: [] });

    await new FeedRepository(db).findThreadPage({
      limit: 21,
      mine: { userId: "reader-1", handle: "hanako" },
    });

    const roots = calls.find((call) => call.include !== undefined);
    expect(roots?.where).toMatchObject({
      AND: [{ OR: [{ authorId: "reader-1" }, { mentions: { has: "hanako" } }] }],
    });
  });
});

describe("FeedRepository reply reads (§10.1, §12.2)", () => {
  it("counts replies for the whole page in one grouped query", async () => {
    const { db, spies } = makeDb();

    const counts = await new FeedRepository(db).countRepliesByThread(["root-1", "root-2"]);

    expect(spies.post.groupBy).toHaveBeenCalledWith({
      by: ["threadRootId"],
      where: { threadRootId: { in: ["root-1", "root-2"] }, replyTo: { not: null } },
      _count: { _all: true },
    });
    expect(counts.get("root-1")).toBe(3);
    expect(counts.get("root-2")).toBeUndefined();
  });

  it("previews replies for every thread in a single query", async () => {
    const { db, spies } = makeDb();

    const replies = await new FeedRepository(db).findLatestRepliesByThread(
      ["root-1", "root-2"],
      2,
    );

    expect(spies.$queryRaw).toHaveBeenCalledTimes(1);
    const statement = spies.$queryRaw.mock.calls[0]?.[0] as { sql: string; values: unknown[] };
    // Top-2-per-group is why raw SQL is here at all; the alternative is a query
    // per thread, which the feed forbids.
    expect(statement.sql).toContain("row_number()");
    expect(statement.sql).toContain("PARTITION BY p.thread_root_id");
    expect(statement.values).toEqual(["root-1", "root-2", 2]);
    // Rows come back as domain posts, mapped exactly like every other post read.
    expect(replies[0]).toMatchObject({ id: "reply-1", replyTo: "root-1" });
  });

  it("asks nothing at all for an empty page", async () => {
    const { db, spies } = makeDb();
    const repository = new FeedRepository(db);

    expect(await repository.countRepliesByThread([])).toEqual(new Map());
    expect(await repository.findLatestRepliesByThread([], 2)).toEqual([]);
    expect(spies.post.groupBy).not.toHaveBeenCalled();
    expect(spies.$queryRaw).not.toHaveBeenCalled();
  });

  it("finds the single newest reply per thread that concerns the reader (§12.3)", async () => {
    const { db, spies } = makeDb();
    spies.$queryRaw.mockResolvedValueOnce([postRow({ id: "reply-2", replyTo: "root-1" })]);

    const byThread = await new FeedRepository(db).findConcerningReplyByThread(
      ["root-1", "root-2"],
      { userId: "reader-1", handle: "hanako" },
    );

    expect(spies.$queryRaw).toHaveBeenCalledTimes(1);
    const statement = spies.$queryRaw.mock.calls[0]?.[0] as { sql: string; values: unknown[] };
    // Ranked by "concerns the reader", not plain recency, and joined to the
    // parent so "a reply whose parent I wrote" can be evaluated per row.
    expect(statement.sql).toContain("row_number()");
    expect(statement.sql).toContain("PARTITION BY p.thread_root_id");
    expect(statement.sql).toContain("LEFT JOIN posts parent");
    expect(statement.values).toEqual(["root-1", "root-2", "reader-1", "hanako"]);
    // One reply per thread at most, keyed by thread.
    expect(byThread.size).toBe(1);
    expect(byThread.get("root-1")).toMatchObject({ id: "reply-2" });
    expect(byThread.get("root-2")).toBeUndefined();
  });

  it("asks nothing for an empty set of threads", async () => {
    const { db, spies } = makeDb();

    const byThread = await new FeedRepository(db).findConcerningReplyByThread([], {
      userId: "reader-1",
      handle: "hanako",
    });

    expect(byThread).toEqual(new Map());
    expect(spies.$queryRaw).not.toHaveBeenCalled();
  });

  /** `threadRootId` is denormalised precisely so this is one indexed read (§8.3). */
  it("reads a whole thread by its root, oldest first, up to the cap", async () => {
    const { db, calls } = makeDb();

    await new FeedRepository(db).findThreadReplies("root-1", 500);

    expect(calls[0]).toMatchObject({
      where: { threadRootId: "root-1", replyTo: { not: null } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 500,
    });
  });
});
