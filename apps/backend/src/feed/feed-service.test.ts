import type { PostDto } from "@brickr/shared";
import { describe, expect, it, vi } from "vitest";
import type { PostService } from "../posts/post-service.js";
import type { Post } from "../posts/post.js";
import type { RoomRepository } from "../rooms/room-repository.js";
import type { RoomMembershipRepository } from "../rooms/room-membership-repository.js";
import { RoomNotFoundError } from "../rooms/room-errors.js";
import type { Room } from "../rooms/room.js";
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
  visibility: "public",
  createdByUserId: "owner-1",
};

const STOPPED_ROOM: FeedRoom = { ...ROOM, id: "room-2", title: "止まった部屋", status: "archived" };

const CLOSED_ROOM: FeedRoom = {
  id: "room-3",
  title: "クローズドルーム",
  status: "active",
  visibility: "closed",
  createdByUserId: "owner-1",
};

const PRIVATE_ROOM: FeedRoom = {
  id: "room-4",
  title: "プライベートルーム",
  status: "active",
  visibility: "private",
  createdByUserId: "owner-1",
};

const READER = { id: "reader-1", isAdmin: false, handle: "hanako" };

function at(minute: number): Date {
  return new Date(Date.UTC(2026, 7, 13, 10, minute, 0, 0));
}

function post(overrides: Partial<Post> & { id: string }): Post {
  const createdAt = overrides.createdAt ?? at(0);
  return {
    roomId: ROOM.id,
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

function makeHarness(input: { posts: Post[]; rooms?: FeedRoom[]; memberRoomIds?: string[] }) {
  const rooms = new Map((input.rooms ?? [ROOM]).map((room) => [room.id, room]));
  const roots = input.posts.filter((entry) => entry.replyTo === null);
  const replies = input.posts.filter((entry) => entry.replyTo !== null);

  // Default: all rooms are visible (public/open). Tests that need closed/private
  // filtering pass `memberRoomIds` to restrict which rooms the reader can see.
  const allRoomIds = [...rooms.keys()];

  const feed = {
    findVisibleRoomIds: vi.fn((userId: string | null, isAdmin = false) => {
      if (isAdmin) return Promise.resolve(allRoomIds);
      if (input.memberRoomIds !== undefined) {
        // Simulate visibility: public/open rooms + rooms the reader is a member of.
        const visibleIds = allRoomIds.filter((id) => {
          const room = rooms.get(id);
          if (!room) return false;
          if (room.visibility === "public" || room.visibility === "open") return true;
          // closed/private: only if the reader is in memberRoomIds.
          return userId !== null && input.memberRoomIds!.includes(id);
        });
        return Promise.resolve(visibleIds);
      }
      // Default: all rooms visible.
      return Promise.resolve(allRoomIds);
    }),
    findThreadPage: vi.fn(
      (query: {
        roomId?: string;
        visibleRoomIds?: string[];
        mine?: { userId: string; handle: string };
        cursor?: { activityAt: Date; id: string };
        limit: number;
      }) => {
        const { mine, cursor } = query;

        let page = roots.filter(
          (root) => !query.roomId || root.roomId === query.roomId,
        );
        // Apply visibility filter when provided.
        if (query.visibleRoomIds !== undefined) {
          page = page.filter((root) => query.visibleRoomIds!.includes(root.roomId));
        }
        if (mine) page = page.filter((root) => concernsUser(root, mine, input.posts));
        page = [...page].sort(newestFirst);
        if (cursor) page = page.filter((root) => isAfterCursor(root, cursor));

        const rows: FeedThreadRow[] = page.slice(0, query.limit).map((root) => {
          const room = rooms.get(root.roomId);
          if (!room) throw new Error(`room "${root.roomId}" missing from fixture`);
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

  const roomRepo = {
    findById: (id: string) => {
      const room = rooms.get(id);
      return Promise.resolve(room ? toRoom(room) : null);
    },
  } as unknown as RoomRepository;

  // Backs `assertRoomReadable`'s real membership lookup (issue #175). Queried
  // for every room regardless of visibility, so its default (no `memberRoomIds`
  // given) is "no membership row" rather than "everyone is a member" — the
  // room's creator still gets in via `toRoomActor`'s createdByUserId fallback,
  // exactly as a real, freshly-created room's owner row would (a role: "member"
  // fake row here would incorrectly outrank that fallback and fail the
  // ownership check).
  const memberships = {
    findOne: vi.fn((roomId: string, _memberKind: string, memberId: string) => {
      const isMember = memberId.length > 0 && (input.memberRoomIds ?? []).includes(roomId);
      return Promise.resolve(
        isMember
          ? {
              id: `mem-${roomId}-${memberId}`,
              roomId,
              memberKind: "user" as const,
              memberId,
              role: "member" as const,
              status: "active" as const,
              createdAt: at(0),
              updatedAt: at(0),
            }
          : null,
      );
    }),
  };

  return {
    service: new FeedService(
      feed as unknown as FeedRepository,
      posts,
      roomRepo,
      memberships as unknown as RoomMembershipRepository,
    ),
    spies: feed,
  };
}

function toDto(entry: Post): PostDto {
  return {
    id: entry.id,
    roomId: entry.roomId,
    author: { id: entry.authorId, handle: entry.authorId, displayName: entry.authorId },
    content: entry.content,
    mentions: entry.mentions,
    replyTo: entry.replyTo,
    quoteOf: entry.quoteOf,
    quotedPost: null,
    createdAt: entry.createdAt.toISOString(),
  };
}

function toRoom(room: FeedRoom): Room {
  return {
    id: room.id,
    title: room.title,
    status: room.status,
    visibility: room.visibility,
    scope: "room",
    tags: [],
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
  it("keeps stopped rooms in the unified feed but refuses to write to them", async () => {
    const stopped = post({ id: "root-1", roomId: STOPPED_ROOM.id });
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
    const stopped = post({ id: "root-1", roomId: STOPPED_ROOM.id });
    const { service } = makeHarness({ posts: [stopped], rooms: [STOPPED_ROOM] });

    const page = await service.getUnifiedFeed({ reader: READER, filter: "all" });

    expect(page.threads[0]?.capabilities.canOpenThread).toBe(false);
  });

  it("names an untitled room without leaking the internal term", async () => {
    const untitled: FeedRoom = { ...ROOM, title: null };
    const { service } = makeHarness({ posts: [post({ id: "root-1" })], rooms: [untitled] });

    const page = await service.getUnifiedFeed({ reader: READER, filter: "all" });

    expect(page.threads[0]?.room.title).toBe("無題のルーム");
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
    const here = post({ id: "root-1", roomId: ROOM.id, createdAt: at(1) });
    const elsewhere = post({ id: "root-2", roomId: STOPPED_ROOM.id, createdAt: at(2) });
    const { service } = makeHarness({ posts: [here, elsewhere], rooms: [ROOM, STOPPED_ROOM] });

    const page = await service.getRoomFeed(ROOM.id, { reader: READER, filter: "all" });

    expect(page.threads.map((thread) => thread.root.id)).toEqual(["root-1"]);
  });

  it("answers as if a stopped room did not exist for anyone else", async () => {
    const { service } = makeHarness({
      posts: [post({ id: "root-1", roomId: STOPPED_ROOM.id })],
      rooms: [STOPPED_ROOM],
    });

    await expect(
      service.getRoomFeed(STOPPED_ROOM.id, { reader: READER, filter: "all" }),
    ).rejects.toThrow(RoomNotFoundError);
  });

  it("opens a stopped room for its creator and for an administrator", async () => {
    const { service } = makeHarness({
      posts: [post({ id: "root-1", roomId: STOPPED_ROOM.id })],
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
        roomId: ROOM.id,
        mine: { userId: READER.id, handle: READER.handle },
      }),
    );
  });

  it("reports an unknown room as not found", async () => {
    const { service } = makeHarness({ posts: [] });

    await expect(
      service.getRoomFeed("missing", { reader: READER, filter: "all" }),
    ).rejects.toThrow(RoomNotFoundError);
  });

  it("refuses a closed room for a non-member", async () => {
    const { service } = makeHarness({
      posts: [post({ id: "root-1", roomId: CLOSED_ROOM.id })],
      rooms: [CLOSED_ROOM],
      // Reader is not a member of the closed room.
      memberRoomIds: [],
    });

    await expect(
      service.getRoomFeed(CLOSED_ROOM.id, { reader: READER, filter: "all" }),
    ).rejects.toThrow(RoomNotFoundError);
  });

  it("opens a closed room for an active member", async () => {
    const { service } = makeHarness({
      posts: [post({ id: "root-1", roomId: CLOSED_ROOM.id })],
      rooms: [CLOSED_ROOM],
      // Reader is an active member of the closed room.
      memberRoomIds: [CLOSED_ROOM.id],
    });

    const page = await service.getRoomFeed(CLOSED_ROOM.id, { reader: READER, filter: "all" });

    expect(page.threads).toHaveLength(1);
  });

  it("opens a closed room for an administrator regardless of membership", async () => {
    const { service } = makeHarness({
      posts: [post({ id: "root-1", roomId: CLOSED_ROOM.id })],
      rooms: [CLOSED_ROOM],
      memberRoomIds: [],
    });

    const page = await service.getRoomFeed(CLOSED_ROOM.id, {
      reader: { id: "admin-1", isAdmin: true, handle: "admin" },
      filter: "all",
    });

    expect(page.threads).toHaveLength(1);
  });

  it("checks only the requested closed room's membership", async () => {
    const { service, spies } = makeHarness({
      posts: [post({ id: "root-1", roomId: CLOSED_ROOM.id })],
      rooms: [CLOSED_ROOM],
      memberRoomIds: [CLOSED_ROOM.id],
    });

    await service.getRoomFeed(CLOSED_ROOM.id, { reader: READER, filter: "all" });

    expect(spies.findVisibleRoomIds).not.toHaveBeenCalled();
  });

  it("refuses a private room for a non-member", async () => {
    const { service } = makeHarness({
      posts: [post({ id: "root-1", roomId: PRIVATE_ROOM.id })],
      rooms: [PRIVATE_ROOM],
      memberRoomIds: [],
    });

    await expect(
      service.getRoomFeed(PRIVATE_ROOM.id, { reader: READER, filter: "all" }),
    ).rejects.toThrow(RoomNotFoundError);
  });
});

describe("FeedService global feed visibility filtering (§10.1)", () => {
  const publicPost = post({ id: "root-public", roomId: ROOM.id, createdAt: at(1) });
  const closedPost = post({ id: "root-closed", roomId: CLOSED_ROOM.id, createdAt: at(2) });
  const privatePost = post({ id: "root-private", roomId: PRIVATE_ROOM.id, createdAt: at(3) });

  it("excludes closed and private room posts from the global feed for non-members", async () => {
    const { service } = makeHarness({
      posts: [publicPost, closedPost, privatePost],
      rooms: [ROOM, CLOSED_ROOM, PRIVATE_ROOM],
      // Reader is not a member of closed or private rooms.
      memberRoomIds: [],
    });

    const page = await service.getUnifiedFeed({ reader: READER, filter: "all" });

    expect(page.threads.map((thread) => thread.root.id)).toEqual(["root-public"]);
  });

  it("includes closed room posts for active members", async () => {
    const { service } = makeHarness({
      posts: [publicPost, closedPost],
      rooms: [ROOM, CLOSED_ROOM],
      // Reader is a member of the closed room.
      memberRoomIds: [CLOSED_ROOM.id],
    });

    const page = await service.getUnifiedFeed({ reader: READER, filter: "all" });

    expect(page.threads.map((thread) => thread.root.id).sort()).toEqual([
      "root-closed",
      "root-public",
    ]);
  });

  it("includes private room posts for active members", async () => {
    const { service } = makeHarness({
      posts: [publicPost, privatePost],
      rooms: [ROOM, PRIVATE_ROOM],
      memberRoomIds: [PRIVATE_ROOM.id],
    });

    const page = await service.getUnifiedFeed({ reader: READER, filter: "all" });

    expect(page.threads.map((thread) => thread.root.id).sort()).toEqual([
      "root-private",
      "root-public",
    ]);
  });

  it("includes every room for administrators", async () => {
    const { service, spies } = makeHarness({
      posts: [publicPost, closedPost, privatePost],
      rooms: [ROOM, CLOSED_ROOM, PRIVATE_ROOM],
      memberRoomIds: [],
    });

    const page = await service.getUnifiedFeed({
      reader: { id: "admin-1", isAdmin: true, handle: "admin" },
      filter: "all",
    });

    expect(page.threads).toHaveLength(3);
    expect(spies.findVisibleRoomIds).toHaveBeenCalledWith("admin-1", true);
  });

  it("excludes closed and private room posts for anonymous readers", async () => {
    const { service } = makeHarness({
      posts: [publicPost, closedPost, privatePost],
      rooms: [ROOM, CLOSED_ROOM, PRIVATE_ROOM],
      memberRoomIds: [],
    });

    const page = await service.getUnifiedFeed({ reader: null, filter: "all" });

    expect(page.threads.map((thread) => thread.root.id)).toEqual(["root-public"]);
  });

  it("passes the visible room ids to the repository query", async () => {
    const { service, spies } = makeHarness({
      posts: [publicPost],
      rooms: [ROOM],
      memberRoomIds: [],
    });

    await service.getUnifiedFeed({ reader: READER, filter: "all" });

    expect(spies.findThreadPage).toHaveBeenCalledWith(
      expect.objectContaining({ visibleRoomIds: expect.any(Array) }),
    );
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
    const stoppedRoot = post({ id: "root-9", roomId: STOPPED_ROOM.id, createdAt: at(0) });
    const stoppedReply = reply({
      id: "reply-9",
      replyTo: "root-9",
      threadRootId: "root-9",
      roomId: STOPPED_ROOM.id,
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
    expect(activity.roomId).toBe(ROOM.id);
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
      createdByUserId: "owner-1",
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
    const homeless = post({ id: "root-3", roomId: "room-missing" });
    const { service } = makeHarness({ posts: [homeless], rooms: [ROOM] });

    await expect(service.buildThreadActivity(homeless)).rejects.toThrow(
      RoomNotFoundError,
    );
  });
});
