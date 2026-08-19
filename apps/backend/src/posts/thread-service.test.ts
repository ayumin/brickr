import { describe, expect, it } from "vitest";
import type { Post } from "./post.js";
import type { PostRepository } from "./post-repository.js";
import { ThreadService, selectContextPosts } from "./thread-service.js";

function at(second: number): Date {
  return new Date(`2026-01-01T00:00:${String(second).padStart(2, "0")}Z`);
}

function makePost(overrides: Partial<Post> & { id: string }): Post {
  return {
    roomId: "sim-1",
    authorId: "user-1",
    content: `content of ${overrides.id}`,
    mentions: [],
    replyTo: null,
    quoteOf: null,
    threadRootId: overrides.id,
    threadActivityAt: at(0),
    createdAt: at(0),
    ...overrides,
  };
}

function idsOf(posts: Post[]): string[] {
  return posts.map((post) => post.id);
}

type RecordedCalls = {
  findById: string[];
  findManyByIds: string[][];
  findReplies: string[];
  findQuotes: string[];
  findRecentByRoom: Array<{ roomId: string; limit: number }>;
};

/**
 * In-memory stand-in implementing only the five repository methods
 * `ThreadService` actually calls. No Prisma, no database.
 */
function makeFakeRepository(posts: readonly Post[]): {
  repository: PostRepository;
  calls: RecordedCalls;
} {
  const calls: RecordedCalls = {
    findById: [],
    findManyByIds: [],
    findReplies: [],
    findQuotes: [],
    findRecentByRoom: [],
  };

  const oldestFirst = (a: Post, b: Post): number =>
    a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);

  const fake = {
    findById(id: string): Promise<Post | null> {
      calls.findById.push(id);
      return Promise.resolve(posts.find((post) => post.id === id) ?? null);
    },
    findManyByIds(ids: string[]): Promise<Post[]> {
      calls.findManyByIds.push([...ids]);
      return Promise.resolve(posts.filter((post) => ids.includes(post.id)));
    },
    findReplies(postId: string): Promise<Post[]> {
      calls.findReplies.push(postId);
      return Promise.resolve(posts.filter((post) => post.replyTo === postId).sort(oldestFirst));
    },
    findQuotes(postId: string): Promise<Post[]> {
      calls.findQuotes.push(postId);
      return Promise.resolve(posts.filter((post) => post.quoteOf === postId).sort(oldestFirst));
    },
    findRecentByRoom(roomId: string, limit: number): Promise<Post[]> {
      calls.findRecentByRoom.push({ roomId, limit });
      const inRoom = posts
        .filter((post) => post.roomId === roomId)
        .sort(oldestFirst);
      return Promise.resolve(limit <= 0 ? [] : inRoom.slice(-limit));
    },
  };

  // Test-only structural stand-in: `PostRepository` carries a private `db`
  // field, so a plain object is not assignable to it without this cast.
  return { repository: fake as unknown as PostRepository, calls };
}

describe("selectContextPosts", () => {
  describe("basic shape", () => {
    it("returns every post in chronological order when under the limit", () => {
      const a = makePost({ id: "a", createdAt: at(1) });
      const b = makePost({ id: "b", createdAt: at(2) });
      const c = makePost({ id: "c", createdAt: at(3) });

      const selected = selectContextPosts({
        threadPosts: [c, a, b],
        ambientPosts: [],
        target: b,
        limit: 10,
      });

      expect(idsOf(selected)).toEqual(["a", "b", "c"]);
    });

    it("includes the target even when it is missing from both groups", () => {
      const a = makePost({ id: "a", createdAt: at(1) });
      const target = makePost({ id: "target", createdAt: at(2) });

      const selected = selectContextPosts({
        threadPosts: [a],
        ambientPosts: [],
        target,
        limit: 10,
      });

      expect(idsOf(selected)).toEqual(["a", "target"]);
    });

    it("de-duplicates posts that appear in both groups", () => {
      const a = makePost({ id: "a", createdAt: at(1) });
      const b = makePost({ id: "b", createdAt: at(2) });

      const selected = selectContextPosts({
        threadPosts: [a, b],
        ambientPosts: [b, a, b],
        target: b,
        limit: 10,
      });

      expect(idsOf(selected)).toEqual(["a", "b"]);
    });

    it("breaks createdAt ties by id so ordering is stable", () => {
      const b = makePost({ id: "b", createdAt: at(1) });
      const a = makePost({ id: "a", createdAt: at(1) });

      const selected = selectContextPosts({
        threadPosts: [b, a],
        ambientPosts: [],
        target: a,
        limit: 10,
      });

      expect(idsOf(selected)).toEqual(["a", "b"]);
    });
  });

  describe("thread posts outrank ambient posts", () => {
    it("keeps thread posts even when every ambient post is newer", () => {
      const root = makePost({ id: "root", createdAt: at(1) });
      const parent = makePost({ id: "parent", createdAt: at(2), replyTo: "root" });
      const target = makePost({ id: "target", createdAt: at(3), replyTo: "parent" });
      const ambient = [11, 12, 13].map((second) =>
        makePost({ id: `n${second}`, createdAt: at(second) }),
      );

      const selected = selectContextPosts({
        threadPosts: [root, parent, target],
        ambientPosts: ambient,
        target,
        limit: 3,
      });

      expect(idsOf(selected)).toEqual(["root", "parent", "target"]);
    });

    it("fills the leftover budget with ambient posts when the thread is small", () => {
      const target = makePost({ id: "target", createdAt: at(5) });
      const ambient = [1, 2, 3].map((second) =>
        makePost({ id: `n${second}`, createdAt: at(second) }),
      );

      const selected = selectContextPosts({
        threadPosts: [target],
        ambientPosts: ambient,
        target,
        limit: 3,
      });

      expect(idsOf(selected)).toEqual(["n2", "n3", "target"]);
    });

    it("drops the oldest ambient posts first when the budget is tight", () => {
      const target = makePost({ id: "target", createdAt: at(10) });
      const ambient = [1, 2, 3, 4].map((second) =>
        makePost({ id: `n${second}`, createdAt: at(second) }),
      );

      const selected = selectContextPosts({
        threadPosts: [target],
        ambientPosts: ambient,
        target,
        limit: 3,
      });

      expect(idsOf(selected)).toEqual(["n3", "n4", "target"]);
    });

    it("keeps the target and the newest ambient post when the target is old", () => {
      const posts = [1, 2, 3, 4, 5].map((second) =>
        makePost({ id: `p${second}`, createdAt: at(second) }),
      );
      const target = posts[0];
      expect(target).toBeDefined();

      const selected = selectContextPosts({
        threadPosts: [],
        ambientPosts: posts,
        target: target as Post,
        limit: 2,
      });

      expect(idsOf(selected)).toEqual(["p1", "p5"]);
    });

    it("trims thread posts newest-first when the thread alone exceeds the limit", () => {
      const root = makePost({ id: "root", createdAt: at(1) });
      const mid = makePost({ id: "mid", createdAt: at(2), replyTo: "root" });
      const target = makePost({ id: "target", createdAt: at(3), replyTo: "mid" });
      const reply = makePost({ id: "reply", createdAt: at(4), replyTo: "target" });

      const selected = selectContextPosts({
        threadPosts: [root, mid, target, reply],
        ambientPosts: [],
        target,
        limit: 2,
      });

      expect(idsOf(selected)).toEqual(["target", "reply"]);
    });
  });

  describe("budget clamping", () => {
    it("returns exactly the target for a limit of 0", () => {
      const target = makePost({ id: "target", createdAt: at(2) });
      const other = makePost({ id: "other", createdAt: at(1) });

      const selected = selectContextPosts({
        threadPosts: [other, target],
        ambientPosts: [other],
        target,
        limit: 0,
      });

      expect(idsOf(selected)).toEqual(["target"]);
    });

    it("returns exactly the target for a negative limit", () => {
      const target = makePost({ id: "target", createdAt: at(2) });
      const other = makePost({ id: "other", createdAt: at(1) });

      const selected = selectContextPosts({
        threadPosts: [other, target],
        ambientPosts: [other],
        target,
        limit: -5,
      });

      expect(idsOf(selected)).toEqual(["target"]);
    });

    it("never returns more than the limit", () => {
      const threadPosts = Array.from({ length: 10 }, (_unused, index) =>
        makePost({ id: `t${index}`, createdAt: at(index) }),
      );
      const ambientPosts = Array.from({ length: 20 }, (_unused, index) =>
        makePost({ id: `a${index}`, createdAt: at(index + 20) }),
      );
      const target = threadPosts[0];
      expect(target).toBeDefined();

      const selected = selectContextPosts({
        threadPosts,
        ambientPosts,
        target: target as Post,
        limit: 7,
      });

      expect(selected).toHaveLength(7);
      expect(idsOf(selected)).toContain("t0");
    });
  });
});

describe("ThreadService.getCurrentThread", () => {
  it("returns null for an unknown target id", async () => {
    const { repository } = makeFakeRepository([makePost({ id: "a", createdAt: at(1) })]);
    const service = new ThreadService(repository, 10);

    await expect(service.getCurrentThread("missing")).resolves.toBeNull();
  });

  it("returns the target and a chronologically ordered context", async () => {
    const posts = [
      makePost({ id: "p3", createdAt: at(3) }),
      makePost({ id: "p1", createdAt: at(1) }),
      makePost({ id: "p2", createdAt: at(2) }),
    ];
    const { repository } = makeFakeRepository(posts);
    const service = new ThreadService(repository, 10);

    const thread = await service.getCurrentThread("p2");

    expect(thread).not.toBeNull();
    expect(thread?.target.id).toBe("p2");
    expect(idsOf(thread?.posts ?? [])).toEqual(["p1", "p2", "p3"]);
  });

  it("keeps the target in context even when it is older than the limit most recent posts", async () => {
    const posts = [1, 2, 3, 4, 5].map((second) =>
      makePost({ id: `p${second}`, createdAt: at(second) }),
    );
    const { repository } = makeFakeRepository(posts);
    const service = new ThreadService(repository, 3);

    const thread = await service.getCurrentThread("p1");

    expect(thread).not.toBeNull();
    expect(idsOf(thread?.posts ?? [])).toContain("p1");
    expect(thread?.posts).toHaveLength(3);
  });

  it("respects the context limit", async () => {
    const posts = Array.from({ length: 25 }, (_unused, index) =>
      makePost({ id: `p${index}`, createdAt: at(index % 60) }),
    );
    const { repository } = makeFakeRepository(posts);
    const service = new ThreadService(repository, 6);

    const thread = await service.getCurrentThread("p20");

    expect(thread?.posts).toHaveLength(6);
  });

  it("walks up a multi-level replyTo chain", async () => {
    const posts = [
      makePost({ id: "a", createdAt: at(1) }),
      makePost({ id: "b", createdAt: at(2), replyTo: "a" }),
      makePost({ id: "c", createdAt: at(3), replyTo: "b" }),
    ];
    const { repository, calls } = makeFakeRepository(posts);
    const service = new ThreadService(repository, 10);

    const thread = await service.getCurrentThread("c");

    expect(idsOf(thread?.posts ?? [])).toEqual(["a", "b", "c"]);
    // One lookup per level of the chain proves the walk, not just the recent fetch.
    expect(calls.findManyByIds).toEqual([["b"], ["a"]]);
  });

  it("pulls in the post a quote points at", async () => {
    const posts = [
      makePost({ id: "orig", createdAt: at(1) }),
      makePost({ id: "quote", createdAt: at(2), quoteOf: "orig" }),
    ];
    const { repository, calls } = makeFakeRepository(posts);
    const service = new ThreadService(repository, 10);

    const thread = await service.getCurrentThread("quote");

    expect(idsOf(thread?.posts ?? [])).toEqual(["orig", "quote"]);
    expect(calls.findManyByIds).toEqual([["orig"]]);
  });

  it("pulls in both the reply parent and the quoted post of the target", async () => {
    const posts = [
      makePost({ id: "orig", createdAt: at(1) }),
      makePost({ id: "parent", createdAt: at(2) }),
      makePost({ id: "target", createdAt: at(3), replyTo: "parent", quoteOf: "orig" }),
    ];
    const { repository, calls } = makeFakeRepository(posts);
    const service = new ThreadService(repository, 10);

    const thread = await service.getCurrentThread("target");

    expect(idsOf(thread?.posts ?? [])).toEqual(["orig", "parent", "target"]);
    expect(calls.findManyByIds[0]).toEqual(["parent", "orig"]);
  });

  it("includes replies and quotes hanging off the target", async () => {
    const posts = [
      makePost({ id: "target", createdAt: at(1) }),
      makePost({ id: "reply", createdAt: at(2), authorId: "c-skeptic", replyTo: "target" }),
      makePost({ id: "quote", createdAt: at(3), authorId: "c-kansai", quoteOf: "target" }),
    ];
    const { repository, calls } = makeFakeRepository(posts);
    const service = new ThreadService(repository, 10);

    const thread = await service.getCurrentThread("target");

    expect(idsOf(thread?.posts ?? [])).toEqual(["target", "reply", "quote"]);
    expect(calls.findReplies).toEqual(["target"]);
    expect(calls.findQuotes).toEqual(["target"]);
  });

  it("de-duplicates posts reachable through several paths", async () => {
    // `parent` is the target's reply parent, is quoted by `sibling`, and also
    // shows up in the recent window.
    const posts = [
      makePost({ id: "parent", createdAt: at(1) }),
      makePost({ id: "target", createdAt: at(2), replyTo: "parent" }),
      makePost({ id: "sibling", createdAt: at(3), replyTo: "target", quoteOf: "parent" }),
    ];
    const { repository } = makeFakeRepository(posts);
    const service = new ThreadService(repository, 10);

    const thread = await service.getCurrentThread("target");
    const ids = idsOf(thread?.posts ?? []);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["parent", "target", "sibling"]);
  });

  it(
    "terminates on a replyTo cycle produced by bad data",
    async () => {
      const posts = [
        makePost({ id: "a", createdAt: at(1), replyTo: "b" }),
        makePost({ id: "b", createdAt: at(2), replyTo: "a" }),
      ];
      const { repository } = makeFakeRepository(posts);
      const service = new ThreadService(repository, 10);

      const thread = await service.getCurrentThread("a");

      expect(thread?.target.id).toBe("a");
      expect(idsOf(thread?.posts ?? [])).toEqual(["a", "b"]);
    },
    1000,
  );

  it("asks the repository only for the target's own room", async () => {
    const posts = [
      makePost({ id: "a", createdAt: at(1) }),
      makePost({ id: "other", roomId: "sim-2", createdAt: at(2) }),
    ];
    const { repository, calls } = makeFakeRepository(posts);
    const service = new ThreadService(repository, 10);

    const thread = await service.getCurrentThread("a");

    expect(idsOf(thread?.posts ?? [])).toEqual(["a"]);
    expect(calls.findRecentByRoom).toEqual([{ roomId: "sim-1", limit: 10 }]);
  });

  describe("regression: a deep reply must not lose its own thread to ambient chatter", () => {
    /**
     * root <- mid <- target, plus five newer unrelated posts.
     *
     * The recent window (`contextLimit` newest posts of the room) consists
     * entirely of the unrelated chatter, so nothing in the target's own thread
     * arrives via the ambient fetch. Only the ancestor walk can supply it.
     */
    const deepThreadRoom = (): readonly Post[] => [
      makePost({ id: "root", createdAt: at(1) }),
      makePost({ id: "mid", createdAt: at(2), authorId: "c-architect", replyTo: "root" }),
      makePost({ id: "target", createdAt: at(3), authorId: "c-skeptic", replyTo: "mid" }),
      ...[10, 11, 12, 13, 14].map((second) =>
        makePost({ id: `n${second}`, createdAt: at(second), authorId: "c-kansai" }),
      ),
    ];

    it("keeps the thread root when ambient posts would fill the budget", async () => {
      const posts = deepThreadRoom();
      const { repository, calls } = makeFakeRepository(posts);
      const service = new ThreadService(repository, 5);

      const thread = await service.getCurrentThread("target");
      const ids = idsOf(thread?.posts ?? []);

      // Precondition: the ambient window on its own would have filled the budget
      // and contained none of the thread.
      expect(calls.findRecentByRoom).toEqual([{ roomId: "sim-1", limit: 5 }]);
      expect(await repository.findRecentByRoom("sim-1", 5)).toHaveLength(5);

      expect(ids).toContain("root");
      expect(ids).toContain("mid");
      expect(ids).toContain("target");
      expect(thread?.posts).toHaveLength(5);
      // The thread comes first; ambient chatter only fills what is left over.
      expect(ids.slice(0, 3)).toEqual(["root", "mid", "target"]);
      expect(ids).not.toContain("n10");
      expect(ids).not.toContain("n11");
    });

    it("squeezes ambient posts out entirely when the thread alone fills the budget", async () => {
      const posts = deepThreadRoom();
      const { repository } = makeFakeRepository(posts);
      const service = new ThreadService(repository, 3);

      const thread = await service.getCurrentThread("target");

      expect(idsOf(thread?.posts ?? [])).toEqual(["root", "mid", "target"]);
    });

    it("still supplies the whole thread when the budget is generous", async () => {
      const posts = deepThreadRoom();
      const { repository } = makeFakeRepository(posts);
      const service = new ThreadService(repository, 20);

      const thread = await service.getCurrentThread("target");
      const ids = idsOf(thread?.posts ?? []);

      expect(ids).toEqual(["root", "mid", "target", "n10", "n11", "n12", "n13", "n14"]);
    });
  });
});
