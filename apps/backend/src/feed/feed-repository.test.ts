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
  scope: "room",
  createdByUserId: "owner-1",
};

function postRow(overrides: Record<string, unknown> = {}) {
  const createdAt = new Date("2026-08-13T10:00:00.000Z");
  return {
    id: "root-1",
    simulationId: "room-1",
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
function makeDb(options: { roots?: Record<string, unknown>[]; threadIds?: string[] } = {}) {
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
            (options.roots ?? [postRow()]).map((root) => ({ ...root, simulation: ROOM_ROW })),
          );
        }
        return Promise.resolve(options.roots ?? []);
      }),
      groupBy: vi.fn(() =>
        Promise.resolve([{ threadRootId: "root-1", _count: { _all: 3 } }]),
      ),
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
      simulation: {
        select: {
          id: true,
          title: true,
          status: true,
          scope: true,
          createdByUserId: true,
        },
      },
    });
    expect(rows[0]?.room).toEqual({
      id: "room-1",
      title: "設計の部屋",
      status: "active",
      scope: "room",
      createdByUserId: "owner-1",
    });
  });

  it("leaves an unowned room's creator absent rather than null", async () => {
    const { db } = makeDb();
    const repository = new FeedRepository(db);
    const spies = db as unknown as { post: { findMany: ReturnType<typeof vi.fn> } };
    spies.post.findMany.mockImplementationOnce(() =>
      Promise.resolve([{ ...postRow(), simulation: { ...ROOM_ROW, createdByUserId: null } }]),
    );

    const rows = await repository.findThreadPage({ limit: 21 });

    expect(rows[0]?.room).not.toHaveProperty("createdByUserId");
  });

  it("restricts to one room when asked", async () => {
    const { db, calls } = makeDb();

    await new FeedRepository(db).findThreadPage({ limit: 21, simulationId: "room-1" });

    expect(calls[0]?.where).toMatchObject({ simulationId: "room-1" });
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
});

describe("FeedRepository mine filter (§12.3)", () => {
  it("collects the threads that concern the reader in two queries, not one per thread", async () => {
    const { db, calls, spies } = makeDb({ threadIds: ["root-7", "root-8"] });

    await new FeedRepository(db).findThreadPage({
      limit: 21,
      mine: { userId: "reader-1", handle: "hanako" },
    });

    const lookups = calls.filter((call) => call.distinct !== undefined);
    expect(lookups).toHaveLength(2);
    // A reply whose parent I wrote, and any post that mentions me.
    expect(lookups[0]?.where).toMatchObject({ replyToPost: { authorId: "reader-1" } });
    expect(lookups[1]?.where).toMatchObject({ mentions: { has: "hanako" } });
    // The unified feed spans every simulation, so neither lookup is narrowed.
    expect(lookups[0]?.where).not.toHaveProperty("simulationId");
    expect(lookups[1]?.where).not.toHaveProperty("simulationId");
    // Three queries in total, whatever the page holds.
    expect(spies.post.findMany).toHaveBeenCalledTimes(3);
  });

  /**
   * A thread never spans simulations (§10.5), so narrowing the lookups changes no
   * result. It stops one room's filter from reading every reply and every mention
   * in the database to build a list the outer query would discard anyway (§26).
   */
  it("narrows both lookups to the room when the caller asked for one", async () => {
    const { db, calls } = makeDb({ threadIds: ["root-7"] });

    await new FeedRepository(db).findThreadPage({
      limit: 21,
      simulationId: "room-1",
      mine: { userId: "reader-1", handle: "hanako" },
    });

    const lookups = calls.filter((call) => call.distinct !== undefined);
    expect(lookups[0]?.where).toMatchObject({
      simulationId: "room-1",
      replyToPost: { authorId: "reader-1" },
    });
    expect(lookups[1]?.where).toMatchObject({
      simulationId: "room-1",
      mentions: { has: "hanako" },
    });
    // The roots keep both of their own conditions.
    const roots = calls.find((call) => call.include !== undefined);
    expect(roots?.where).toMatchObject({ replyTo: null, simulationId: "room-1" });
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
