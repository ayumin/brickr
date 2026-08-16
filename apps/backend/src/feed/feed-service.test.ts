import { GLOBAL_SIMULATION_ID, GLOBAL_SIMULATION_TITLE, type PostDto } from "@brickr/shared";
import { describe, expect, it, vi } from "vitest";
import type { PostService } from "../posts/post-service.js";
import type { Post } from "../posts/post.js";
import type { SimulationRepository } from "../simulation/simulation-repository.js";
import { SimulationNotFoundError } from "../simulation/simulation-service.js";
import type { Simulation } from "../simulation/simulation.js";
import type { FeedRepository, FeedRoom, FeedThreadRow } from "./feed-repository.js";
import { FeedService, FEED_PAGE_SIZE, THREAD_REPLIES_LIMIT, ThreadRootNotFoundError } from "./feed-service.js";

/**
 * A stand-in for the feed repository that keeps posts in memory and applies the
 * same ordering, cursor and filter rules its SQL does.
 *
 * It exists so the rules the service owns — page boundaries, the tiebreaker,
 * cursor round trips, preview order, capabilities — are pinned without a
 * database. The SQL itself is checked separately: query shape in
 * `feed-repository.test.ts`, execution against Postgres in CI.
 */
const ROOM: FeedRoom = {
  id: "room-1",
  title: "設計の部屋",
  status: "active",
  scope: "room",
  createdByUserId: "owner-1",
};

const FEED_ROOM: FeedRoom = {
  id: GLOBAL_SIMULATION_ID,
  title: GLOBAL_SIMULATION_TITLE,
  status: "active",
  scope: "global",
};

const STOPPED_ROOM: FeedRoom = { ...ROOM, id: "room-2", title: "止まった部屋", status: "stopped" };

const READER = { id: "reader-1", isAdmin: false, handle: "hanako" };

function at(minute: number): Date {
  return new Date(Date.UTC(2026, 7, 13, 10, minute, 0, 0));
}

function post(overrides: Partial<Post> & { id: string }): Post {
  const createdAt = overrides.createdAt ?? at(0);
  return {
    simulationId: ROOM.id,
    authorId: "author-1",
    content: overrides.id,
    mentions: [],
    replyTo: null,
    quoteOf: null,
    threadRootId: overrides.id,
    threadActivityAt: createdAt,
    createdAt,
    ...overrides,
  };
}

function reply(overrides: Partial<Post> & { id: string; replyTo: string; threadRootId: string }): Post {
  return post(overrides);
}

function makeHarness(input: { posts: Post[]; rooms?: FeedRoom[] }) {
  const rooms = new Map((input.rooms ?? [ROOM]).map((room) => [room.id, room]));
  const roots = input.posts.filter((entry) => entry.replyTo === null);
  const replies = input.posts.filter((entry) => entry.replyTo !== null);

  const feed = {
    findThreadPage: vi.fn(
      (query: {
        simulationId?: string;
        mine?: { userId: string; handle: string };
        cursor?: { activityAt: Date; id: string };
        limit: number;
      }) => {
        const { mine, cursor } = query;

        let page = roots.filter(
          (root) => !query.simulationId || root.simulationId === query.simulationId,
        );
        if (mine) page = page.filter((root) => concernsUser(root, mine, input.posts));
        page = [...page].sort(newestFirst);
        if (cursor) page = page.filter((root) => isAfterCursor(root, cursor));

        const rows: FeedThreadRow[] = page.slice(0, query.limit).map((root) => {
          const room = rooms.get(root.simulationId);
          if (!room) throw new Error(`room "${root.simulationId}" missing from fixture`);
          return { root, room };
        });
        return Promise.resolve(rows);
      },
    ),
    countRepliesByThread: vi.fn((rootIds: string[]) =>
      Promise.resolve(
        new Map(
          rootIds.map((rootId) => [
            rootId,
            replies.filter((entry) => entry.threadRootId === rootId).length,
          ]),
        ),
      ),
    ),
    findLatestRepliesByThread: vi.fn((rootIds: string[], perThread: number) =>
      Promise.resolve(
        rootIds
          .flatMap((rootId) =>
            replies
              .filter((entry) => entry.threadRootId === rootId)
              .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
              .slice(0, perThread),
          )
          .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime()),
      ),
    ),
    findThreadReplies: vi.fn((threadRootId: string, limit: number) =>
      Promise.resolve(
        replies
          .filter((entry) => entry.threadRootId === threadRootId)
          .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
          .slice(0, limit),
      ),
    ),
    findConcerningReplyByThread: vi.fn((rootIds: string[], mine: { userId: string; handle: string }) => {
      const byThread = new Map<string, Post>();
      for (const rootId of rootIds) {
        const concerning = replies
          .filter((entry) => entry.threadRootId === rootId)
          .filter(
            (entry) =>
              entry.mentions.includes(mine.handle) ||
              input.posts.find((parent) => parent.id === entry.replyTo)?.authorId === mine.userId,
          )
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
        if (concerning) byThread.set(rootId, concerning);
      }
      return Promise.resolve(byThread);
    }),
  };

  const posts = {
    findById: (id: string) => Promise.resolve(input.posts.find((entry) => entry.id === id) ?? null),
    toDtos: (batch: Post[]) => Promise.resolve(batch.map(toDto)),
  } as unknown as PostService;

  const simulations = {
    findById: (id: string) => {
      const room = rooms.get(id);
      return Promise.resolve(room ? toSimulation(room) : null);
    },
  } as unknown as SimulationRepository;

  return {
    service: new FeedService(feed as unknown as FeedRepository, posts, simulations),
    spies: feed,
  };
}

function toDto(entry: Post): PostDto {
  return {
    id: entry.id,
    simulationId: entry.simulationId,
    author: { id: entry.authorId, handle: entry.authorId, displayName: entry.authorId },
    content: entry.content,
    mentions: entry.mentions,
    replyTo: entry.replyTo,
    quoteOf: entry.quoteOf,
    quotedPost: null,
    createdAt: entry.createdAt.toISOString(),
  };
}

function toSimulation(room: FeedRoom): Simulation {
  return {
    id: room.id,
    title: room.title,
    status: room.status,
    scope: room.scope,
    createdAt: at(0),
    lastActivityAt: at(0),
    ...(room.createdByUserId ? { createdByUserId: room.createdByUserId } : {}),
  };
}

function newestFirst(left: Post, right: Post): number {
  const byActivity = right.threadActivityAt.getTime() - left.threadActivityAt.getTime();
  return byActivity !== 0 ? byActivity : right.id.localeCompare(left.id);
}

function isAfterCursor(root: Post, cursor: { activityAt: Date; id: string }): boolean {
  const activity = root.threadActivityAt.getTime();
  const boundary = cursor.activityAt.getTime();
  return activity < boundary || (activity === boundary && root.id < cursor.id);
}

/**
 * Mirrors §12.3: root is mine, a reply answers a post of mine, I am mentioned,
 * or the root quotes a post of mine.
 */
function concernsUser(root: Post, mine: { userId: string; handle: string }, all: Post[]): boolean {
  if (root.authorId === mine.userId) return true;
  if (root.mentions.includes(mine.handle)) return true;
  if (root.quoteOf !== null && all.find((entry) => entry.id === root.quoteOf)?.authorId === mine.userId) {
    return true;
  }

  const thread = all.filter((entry) => entry.threadRootId === root.id);
  return thread.some(
    (entry) =>
      entry.mentions.includes(mine.handle) ||
      (entry.replyTo !== null &&
        all.find((parent) => parent.id === entry.replyTo)?.authorId === mine.userId),
  );
}

describe("FeedService paging (§9.4, §10.1)", () => {
  /** 25 threads, one minute apart, so the boundary is unambiguous. */
  const many = Array.from({ length: 25 }, (_, index) =>
    post({ id: `root-${String(index).padStart(2, "0")}`, createdAt: at(index) }),
  );

  it("serves exactly one page and offers a cursor when more remain", async () => {
    const { service } = makeHarness({ posts: many });

    const page = await service.getUnifiedFeed({ reader: READER, filter: "all" });

    expect(page.threads).toHaveLength(FEED_PAGE_SIZE);
    expect(page.nextCursor).not.toBeNull();
    // Newest first, and the 21st thread is not leaked into the page.
    expect(page.threads[0]?.root.id).toBe("root-24");
    expect(page.threads.at(-1)?.root.id).toBe("root-05");
  });

  it("pages through everything without a repeat or a gap", async () => {
    const { service } = makeHarness({ posts: many });

    const first = await service.getUnifiedFeed({ reader: READER, filter: "all" });
    const second = await service.getUnifiedFeed({
      reader: READER,
      filter: "all",
      ...(first.nextCursor ? { cursor: first.nextCursor } : {}),
    });

    const seen = [...first.threads, ...second.threads].map((thread) => thread.root.id);
    expect(second.threads).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(new Set(seen).size).toBe(25);
    expect(seen).toEqual([...many].reverse().map((entry) => entry.id));
  });

  /**
   * The reason the cursor carries an id (§9.4). Threads 19–21 share a timestamp,
   * so the page boundary falls inside the tie: without the tiebreaker one of them
   * would come back twice or not at all.
   */
  it("keeps a page boundary inside a same-millisecond tie exact", async () => {
    const tied = Array.from({ length: 24 }, (_, index) =>
      post({
        id: `root-${String(index).padStart(2, "0")}`,
        createdAt: index >= 3 && index <= 5 ? at(99) : at(index),
      }),
    );
    const { service } = makeHarness({ posts: tied });

    const first = await service.getUnifiedFeed({ reader: READER, filter: "all" });
    const second = await service.getUnifiedFeed({
      reader: READER,
      filter: "all",
      ...(first.nextCursor ? { cursor: first.nextCursor } : {}),
    });

    const seen = [...first.threads, ...second.threads].map((thread) => thread.root.id);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(24);
  });

  it("stops offering a cursor when the last page is exactly full", async () => {
    const exact = Array.from({ length: FEED_PAGE_SIZE }, (_, index) =>
      post({ id: `root-${String(index).padStart(2, "0")}`, createdAt: at(index) }),
    );
    const { service } = makeHarness({ posts: exact });

    const page = await service.getUnifiedFeed({ reader: READER, filter: "all" });

    expect(page.threads).toHaveLength(FEED_PAGE_SIZE);
    expect(page.nextCursor).toBeNull();
  });

  it("asks for one row beyond the page instead of counting the feed", async () => {
    const { service, spies } = makeHarness({ posts: many });

    await service.getUnifiedFeed({ reader: READER, filter: "all" });

    expect(spies.findThreadPage).toHaveBeenCalledWith(
      expect.objectContaining({ limit: FEED_PAGE_SIZE + 1 }),
    );
  });
});

describe("FeedService reply previews (§12.2)", () => {
  const root = post({ id: "root-1", createdAt: at(0) });
  const replies = [
    reply({ id: "reply-1", replyTo: "root-1", threadRootId: "root-1", createdAt: at(1) }),
    reply({ id: "reply-2", replyTo: "reply-1", threadRootId: "root-1", createdAt: at(2) }),
    reply({ id: "reply-3", replyTo: "root-1", threadRootId: "root-1", createdAt: at(3) }),
  ];

  it("previews the newest two, oldest first, and counts them all", async () => {
    const { service } = makeHarness({ posts: [root, ...replies] });

    const page = await service.getUnifiedFeed({ reader: READER, filter: "all" });
    const thread = page.threads[0];

    // Selected newest-first, displayed oldest-first: the two directions differ.
    expect(thread?.latestReplies.map((entry) => entry.id)).toEqual(["reply-2", "reply-3"]);
    expect(thread?.replyCount).toBe(3);
    expect(thread?.capabilities.canLoadMoreReplies).toBe(true);
  });

  it("keeps each thread's previews with its own thread", async () => {
    const other = post({ id: "root-2", createdAt: at(5) });
    const otherReply = reply({
      id: "reply-9",
      replyTo: "root-2",
      threadRootId: "root-2",
      createdAt: at(6),
    });
    const { service } = makeHarness({ posts: [root, ...replies, other, otherReply] });

    const page = await service.getUnifiedFeed({ reader: READER, filter: "all" });

    expect(page.threads.map((thread) => thread.latestReplies.map((entry) => entry.id))).toEqual([
      ["reply-9"],
      ["reply-2", "reply-3"],
    ]);
  });

  it("reports the thread's own activity time, not the root's creation time", async () => {
    const bumped = post({ id: "root-3", createdAt: at(0), threadActivityAt: at(9) });
    const { service } = makeHarness({ posts: [bumped] });

    const page = await service.getUnifiedFeed({ reader: READER, filter: "all" });

    expect(page.threads[0]?.lastActivityAt).toBe(at(9).toISOString());
  });
});

describe("FeedService rooms and capabilities (§10.1, §16.3)", () => {
  it("labels the reserved global row as the feed", async () => {
    const globalPost = post({ id: "root-1", simulationId: GLOBAL_SIMULATION_ID });
    const { service } = makeHarness({ posts: [globalPost], rooms: [FEED_ROOM] });

    const page = await service.getUnifiedFeed({ reader: READER, filter: "all" });

    expect(page.threads[0]?.room).toEqual({
      id: GLOBAL_SIMULATION_ID,
      title: GLOBAL_SIMULATION_TITLE,
      isFeed: true,
    });
  });

  it("keeps stopped rooms in the unified feed but refuses to write to them", async () => {
    const stopped = post({ id: "root-1", simulationId: STOPPED_ROOM.id });
    const { service } = makeHarness({ posts: [stopped], rooms: [STOPPED_ROOM] });

    const page = await service.getUnifiedFeed({
      reader: { id: "owner-1", isAdmin: false, handle: "owner" },
      filter: "all",
    });

    expect(page.threads).toHaveLength(1);
    expect(page.threads[0]?.capabilities).toMatchObject({
      canReply: false,
      canQuote: false,
      canOpenRoom: false,
      // The creator may still read it in full.
      canOpenThread: true,
    });
  });

  it("gives an anonymous reader the posts and no actions", async () => {
    const { service } = makeHarness({ posts: [post({ id: "root-1" })] });

    const page = await service.getUnifiedFeed({ reader: null, filter: "all" });

    expect(page.threads).toHaveLength(1);
    expect(Object.values(page.threads[0]?.capabilities ?? {})).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("does not mistake a stranger for the room owner", async () => {
    const stopped = post({ id: "root-1", simulationId: STOPPED_ROOM.id });
    const { service } = makeHarness({ posts: [stopped], rooms: [STOPPED_ROOM] });

    const page = await service.getUnifiedFeed({ reader: READER, filter: "all" });

    expect(page.threads[0]?.capabilities.canOpenThread).toBe(false);
  });

  it("names an untitled room without leaking the internal term", async () => {
    const untitled: FeedRoom = { ...ROOM, title: null };
    const { service } = makeHarness({ posts: [post({ id: "root-1" })], rooms: [untitled] });

    const page = await service.getUnifiedFeed({ reader: READER, filter: "all" });

    expect(page.threads[0]?.room.title).toBe("無題のルーム");
    expect(page.threads[0]?.room.isFeed).toBe(false);
  });
});

describe("FeedService mine filter (§12.3)", () => {
  const mine = { id: "reader-1", isAdmin: false, handle: "hanako" };

  const ownRoot = post({ id: "root-own", authorId: mine.id, createdAt: at(1) });
  const answeredRoot = post({ id: "root-answered", authorId: "someone", createdAt: at(2) });
  const myPostInThread = reply({
    id: "reply-mine",
    replyTo: "root-answered",
    threadRootId: "root-answered",
    authorId: mine.id,
    createdAt: at(3),
  });
  const answerToMe = reply({
    id: "reply-to-me",
    replyTo: "reply-mine",
    threadRootId: "root-answered",
    authorId: "someone",
    createdAt: at(4),
  });
  const mentionedRoot = post({
    id: "root-mentioned",
    authorId: "someone",
    mentions: [mine.handle],
    createdAt: at(5),
  });
  const strangerRoot = post({ id: "root-stranger", authorId: "someone", createdAt: at(6) });
  const participatedRoot = post({ id: "root-participated", authorId: "someone", createdAt: at(7) });
  const myReplyThere = reply({
    id: "reply-participation",
    replyTo: "root-participated",
    threadRootId: "root-participated",
    authorId: mine.id,
    createdAt: at(8),
  });

  const fixture = [
    ownRoot,
    answeredRoot,
    myPostInThread,
    answerToMe,
    mentionedRoot,
    strangerRoot,
    participatedRoot,
    myReplyThere,
  ];

  it("passes the reader's id and handle to the query, since mentions match by handle", async () => {
    const { service, spies } = makeHarness({ posts: fixture });

    await service.getUnifiedFeed({ reader: mine, filter: "mine" });

    expect(spies.findThreadPage).toHaveBeenCalledWith(
      expect.objectContaining({ mine: { userId: mine.id, handle: mine.handle } }),
    );
  });

  it("returns the three kinds of thread that concern me and nothing else", async () => {
    const { service } = makeHarness({ posts: fixture });

    const page = await service.getUnifiedFeed({ reader: mine, filter: "mine" });

    expect(page.threads.map((thread) => thread.root.id).sort()).toEqual([
      "root-answered",
      "root-mentioned",
      "root-own",
    ]);
  });

  it("asks for no filter at all when the reader wants everything", async () => {
    const { service, spies } = makeHarness({ posts: fixture });

    await service.getUnifiedFeed({ reader: mine, filter: "all" });

    expect(spies.findThreadPage).toHaveBeenCalledWith(
      expect.not.objectContaining({ mine: expect.anything() }),
    );
  });

  it("includes a root that quotes a post of mine, since a quote repost is always its own root (§8.3, §12.1)", async () => {
    const quotedRoot = post({ id: "root-quoted-by-someone", authorId: mine.id, createdAt: at(9) });
    const quoteOfMine = post({
      id: "root-quote-repost",
      authorId: "someone",
      quoteOf: "root-quoted-by-someone",
      createdAt: at(10),
    });
    const { service } = makeHarness({ posts: [...fixture, quotedRoot, quoteOfMine] });

    const page = await service.getUnifiedFeed({ reader: mine, filter: "mine" });

    expect(page.threads.map((thread) => thread.root.id)).toContain("root-quote-repost");
  });

  it("backfills a reply that concerns me when newer, unrelated replies would otherwise push it out of the preview", async () => {
    const root = post({ id: "root-mixed", authorId: "someone", createdAt: at(9) });
    const oldReplyToMe = reply({
      id: "reply-old-concerning",
      replyTo: "root-mixed",
      threadRootId: "root-mixed",
      authorId: mine.id,
      createdAt: at(10),
    });
    const answerToOldReply = reply({
      id: "reply-answers-me",
      replyTo: "reply-old-concerning",
      threadRootId: "root-mixed",
      authorId: "someone",
      createdAt: at(11),
    });
    const unrelated1 = reply({
      id: "reply-unrelated-1",
      replyTo: "root-mixed",
      threadRootId: "root-mixed",
      authorId: "someone",
      createdAt: at(12),
    });
    const unrelated2 = reply({
      id: "reply-unrelated-2",
      replyTo: "root-mixed",
      threadRootId: "root-mixed",
      authorId: "someone",
      createdAt: at(13),
    });
    const { service } = makeHarness({
      posts: [...fixture, root, oldReplyToMe, answerToOldReply, unrelated1, unrelated2],
    });

    const minePage = await service.getUnifiedFeed({ reader: mine, filter: "mine" });
    const mixedThread = minePage.threads.find((thread) => thread.root.id === "root-mixed");

    // Without the backfill, the top-2-by-recency preview would be
    // [reply-unrelated-1, reply-unrelated-2] - the concerning reply that
    // answered me would be invisible without expanding the thread.
    expect(mixedThread?.latestReplies.map((entry) => entry.id)).toEqual([
      "reply-answers-me",
      "reply-unrelated-2",
    ]);
    // The `all` filter is unaffected: same thread, ordinary top-2 preview.
    const allPage = await service.getUnifiedFeed({ reader: mine, filter: "all" });
    const mixedThreadAll = allPage.threads.find((thread) => thread.root.id === "root-mixed");
    expect(mixedThreadAll?.latestReplies.map((entry) => entry.id)).toEqual([
      "reply-unrelated-1",
      "reply-unrelated-2",
    ]);
  });
});

describe("FeedService room feed (§10.2, §10.4)", () => {
  it("returns only that room's threads", async () => {
    const here = post({ id: "root-1", simulationId: ROOM.id, createdAt: at(1) });
    const elsewhere = post({ id: "root-2", simulationId: STOPPED_ROOM.id, createdAt: at(2) });
    const { service } = makeHarness({ posts: [here, elsewhere], rooms: [ROOM, STOPPED_ROOM] });

    const page = await service.getRoomFeed(ROOM.id, { reader: READER, filter: "all" });

    expect(page.threads.map((thread) => thread.root.id)).toEqual(["root-1"]);
  });

  /** The global row is the feed; serving it here would give it a second surface. */
  it("refuses the reserved global simulation", async () => {
    const { service } = makeHarness({
      posts: [post({ id: "root-1", simulationId: GLOBAL_SIMULATION_ID })],
      rooms: [FEED_ROOM],
    });

    await expect(
      service.getRoomFeed(GLOBAL_SIMULATION_ID, { reader: READER, filter: "all" }),
    ).rejects.toThrow(SimulationNotFoundError);
  });

  it("answers as if a stopped room did not exist for anyone else", async () => {
    const { service } = makeHarness({
      posts: [post({ id: "root-1", simulationId: STOPPED_ROOM.id })],
      rooms: [STOPPED_ROOM],
    });

    await expect(
      service.getRoomFeed(STOPPED_ROOM.id, { reader: READER, filter: "all" }),
    ).rejects.toThrow(SimulationNotFoundError);
  });

  it("opens a stopped room for its creator and for an administrator", async () => {
    const { service } = makeHarness({
      posts: [post({ id: "root-1", simulationId: STOPPED_ROOM.id })],
      rooms: [STOPPED_ROOM],
    });

    const asOwner = await service.getRoomFeed(STOPPED_ROOM.id, {
      reader: { id: "owner-1", isAdmin: false, handle: "owner" },
      filter: "all",
    });
    const asAdmin = await service.getRoomFeed(STOPPED_ROOM.id, {
      reader: { id: "admin-1", isAdmin: true, handle: "admin" },
      filter: "all",
    });

    expect(asOwner.threads).toHaveLength(1);
    expect(asAdmin.threads).toHaveLength(1);
  });

  /** Both scopes reach the repository together, so it can narrow its lookups (§26). */
  it("asks for the room and the mine filter in one query description", async () => {
    const { service, spies } = makeHarness({ posts: [post({ id: "root-1" })] });

    await service.getRoomFeed(ROOM.id, { reader: READER, filter: "mine" });

    expect(spies.findThreadPage).toHaveBeenCalledWith(
      expect.objectContaining({
        simulationId: ROOM.id,
        mine: { userId: READER.id, handle: READER.handle },
      }),
    );
  });

  it("reports an unknown room as not found", async () => {
    const { service } = makeHarness({ posts: [] });

    await expect(
      service.getRoomFeed("missing", { reader: READER, filter: "all" }),
    ).rejects.toThrow(SimulationNotFoundError);
  });
});

describe("FeedService thread replies (§12.2, §10.8)", () => {
  const root = post({ id: "root-1", createdAt: at(0) });
  const first = reply({ id: "reply-1", replyTo: "root-1", threadRootId: "root-1", createdAt: at(1) });
  const nested = reply({
    id: "reply-2",
    replyTo: "reply-1",
    threadRootId: "root-1",
    createdAt: at(2),
  });

  it("returns every transitive reply, oldest first, flattened", async () => {
    const { service, spies } = makeHarness({ posts: [root, first, nested] });

    const replies = await service.listThreadReplies("root-1", READER);

    expect(replies.map((entry) => entry.id)).toEqual(["reply-1", "reply-2"]);
    expect(spies.findThreadReplies).toHaveBeenCalledWith("root-1", THREAD_REPLIES_LIMIT);
  });

  /** A reply id would come back as an empty list, which reads like "no replies". */
  it("refuses a post that is not a thread root", async () => {
    const { service } = makeHarness({ posts: [root, first] });

    await expect(service.listThreadReplies("reply-1", READER)).rejects.toThrow(ThreadRootNotFoundError);
  });

  it("refuses an unknown thread", async () => {
    const { service } = makeHarness({ posts: [root] });

    await expect(service.listThreadReplies("missing", READER)).rejects.toThrow(ThreadRootNotFoundError);
  });

  it("hides a stopped room's replies from everyone but its creator or an administrator", async () => {
    const stoppedRoot = post({ id: "root-9", simulationId: STOPPED_ROOM.id, createdAt: at(0) });
    const stoppedReply = reply({
      id: "reply-9",
      replyTo: "root-9",
      threadRootId: "root-9",
      simulationId: STOPPED_ROOM.id,
      createdAt: at(1),
    });
    const { service } = makeHarness({
      posts: [stoppedRoot, stoppedReply],
      rooms: [STOPPED_ROOM],
    });

    await expect(service.listThreadReplies("root-9", READER)).rejects.toThrow(ThreadRootNotFoundError);
    await expect(
      service.listThreadReplies("root-9", { id: "owner-1", isAdmin: false, handle: "owner" }),
    ).resolves.toHaveLength(1);
  });
});

/**
 * The payload a post event carries (§11.3). Built here rather than in the event
 * so a live update and a fresh page describe a thread identically.
 */
describe("FeedService.buildThreadActivity (§11.3)", () => {
  const root = post({ id: "root-1", createdAt: at(0) });
  const replies = [
    reply({ id: "reply-1", replyTo: "root-1", threadRootId: "root-1", createdAt: at(1) }),
    reply({ id: "reply-2", replyTo: "root-1", threadRootId: "root-1", createdAt: at(2) }),
    reply({ id: "reply-3", replyTo: "reply-2", threadRootId: "root-1", createdAt: at(3) }),
  ];

  it("describes the whole thread, not the post that triggered it", async () => {
    const { service } = makeHarness({ posts: [root, ...replies] });

    const activity = await service.buildThreadActivity(replies[2] as Post);

    expect(activity.type).toBe("thread.activity");
    expect(activity.simulationId).toBe(ROOM.id);
    expect(activity.thread.root.id).toBe("root-1");
    // Same preview rule as a page: newest two, oldest first (§12.2).
    expect(activity.thread.latestReplies.map((entry) => entry.id)).toEqual([
      "reply-2",
      "reply-3",
    ]);
    expect(activity.thread.replyCount).toBe(3);
  });

  it("works when the new post is the thread root itself", async () => {
    const { service } = makeHarness({ posts: [root] });

    const activity = await service.buildThreadActivity(root);

    expect(activity.thread.root.id).toBe("root-1");
    expect(activity.thread.replyCount).toBe(0);
    expect(activity.thread.lastActivityAt).toBe(root.threadActivityAt.toISOString());
  });

  /**
   * Capabilities are the one reader-dependent part of the DTO, so the event
   * carries the anonymous baseline and each subscriber's are resolved at delivery
   * (`public-events.ts`). Sending one reader's capabilities to everybody would
   * hand a stranger somebody else's permissions.
   */
  it("leaves capabilities at their anonymous baseline, with the room attached", async () => {
    const { service } = makeHarness({ posts: [root] });

    const activity = await service.buildThreadActivity(root);

    expect(Object.values(activity.thread.capabilities)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    // Enough for the delivery boundary to recompute them without another read.
    expect(activity.room).toMatchObject({
      id: ROOM.id,
      status: "active",
      scope: "room",
      createdByUserId: "owner-1",
    });
  });

  it("labels a post in the reserved global row as the feed", async () => {
    const globalPost = post({ id: "root-2", simulationId: GLOBAL_SIMULATION_ID });
    const { service } = makeHarness({ posts: [globalPost], rooms: [FEED_ROOM] });

    const activity = await service.buildThreadActivity(globalPost);

    expect(activity.thread.room).toEqual({
      id: GLOBAL_SIMULATION_ID,
      title: GLOBAL_SIMULATION_TITLE,
      isFeed: true,
    });
  });

  it("refuses to describe a thread whose root is gone", async () => {
    const orphan = reply({
      id: "reply-9",
      replyTo: "missing",
      threadRootId: "missing",
      createdAt: at(1),
    });
    const { service } = makeHarness({ posts: [orphan] });

    await expect(service.buildThreadActivity(orphan)).rejects.toThrow(ThreadRootNotFoundError);
  });

  it("refuses to describe a thread whose room is gone", async () => {
    const homeless = post({ id: "root-3", simulationId: "room-missing" });
    const { service } = makeHarness({ posts: [homeless], rooms: [ROOM] });

    await expect(service.buildThreadActivity(homeless)).rejects.toThrow(
      SimulationNotFoundError,
    );
  });
});
