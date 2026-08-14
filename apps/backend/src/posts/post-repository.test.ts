import { describe, expect, it, vi } from "vitest";
import type { Db, DbTransaction } from "../persistence/prisma.js";
import { PostRepository, ReplyTargetNotFoundError } from "./post-repository.js";
import type { NewPost } from "./post.js";

/** `parents` are the posts a reply can be answered with, keyed by id. */
function makeDb(parents: Record<string, string> = {}) {
  const tx = {
    post: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ imageUrl: null, ...data }),
      ),
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id in parents ? { threadRootId: parents[where.id] as string } : null,
        ),
      ),
      update: vi.fn(() => Promise.resolve({})),
    },
    simulation: { update: vi.fn(() => Promise.resolve({})) },
  };

  const db = {
    $transaction: vi.fn((run: (client: DbTransaction) => Promise<unknown>) =>
      run(tx as unknown as DbTransaction),
    ),
  } as unknown as Db;

  return { db, tx };
}

function newPost(overrides: Partial<NewPost> & { id: string }): NewPost {
  return {
    simulationId: "sim-1",
    authorId: "user-1",
    content: "content",
    mentions: [],
    replyTo: null,
    quoteOf: null,
    ...overrides,
  };
}

describe("PostRepository.createWithThreadActivity (§8.4)", () => {
  it("writes the post and the room activity in one transaction", async () => {
    const { db, tx } = makeDb();

    const post = await new PostRepository(db).createWithThreadActivity(
      newPost({ id: "post-1" }),
    );

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.simulation.update).toHaveBeenCalledWith({
      where: { id: "sim-1" },
      data: { lastActivityAt: post.createdAt },
    });
  });

  it("stamps a new thread's activity with its own creation time", async () => {
    const { db, tx } = makeDb();

    const post = await new PostRepository(db).createWithThreadActivity(
      newPost({ id: "post-1" }),
    );

    expect(post.threadActivityAt).toEqual(post.createdAt);
    // Its own root, so there is no other post to bump.
    expect(tx.post.update).not.toHaveBeenCalled();
  });

  it("pushes the root back to the top of the feed when a reply arrives", async () => {
    const { db, tx } = makeDb({ "root-1": "root-1" });

    const reply = await new PostRepository(db).createWithThreadActivity(
      newPost({ id: "reply-1", replyTo: "root-1" }),
    );

    expect(tx.post.update).toHaveBeenCalledWith({
      where: { id: "root-1" },
      data: { threadActivityAt: reply.createdAt },
    });
  });

  /**
   * A quote repost is a new topic, not a continuation: bumping the post it quotes
   * would let a thread resurface over and over through quoting (§8.3).
   */
  it("leaves the quoted thread's position alone", async () => {
    const { db, tx } = makeDb();

    await new PostRepository(db).createWithThreadActivity(
      newPost({ id: "quote-1", quoteOf: "root-1" }),
    );

    expect(tx.post.update).not.toHaveBeenCalled();
    expect(tx.simulation.update).toHaveBeenCalledTimes(1);
  });
});

/**
 * The rules live here rather than in `PostService` because the root is read in the
 * same transaction as the insert (§8.3, §8.4): a root resolved beforehand would
 * describe the thread as it looked before the transaction opened.
 */
describe("PostRepository thread root resolution (§8.3)", () => {
  it("makes a top-level post its own root without looking anything up", async () => {
    const { db, tx } = makeDb();

    const post = await new PostRepository(db).createWithThreadActivity(newPost({ id: "post-1" }));

    expect(post.threadRootId).toBe("post-1");
    expect(tx.post.findUnique).not.toHaveBeenCalled();
  });

  it("gives a reply the root of the post it answers, inside the same transaction", async () => {
    const { db, tx } = makeDb({ "root-1": "root-1" });

    const reply = await new PostRepository(db).createWithThreadActivity(
      newPost({ id: "reply-1", replyTo: "root-1" }),
    );

    expect(reply.threadRootId).toBe("root-1");
    expect(tx.post.findUnique).toHaveBeenCalledWith({
      where: { id: "root-1" },
      select: { threadRootId: true },
    });
  });

  it("keeps the same root however deep the reply chain runs", async () => {
    const { db } = makeDb({ "reply-1": "root-1" });

    const reply = await new PostRepository(db).createWithThreadActivity(
      newPost({ id: "reply-2", replyTo: "reply-1" }),
    );

    expect(reply.threadRootId).toBe("root-1");
  });

  it("starts a new thread for a quote repost instead of joining the quoted one", async () => {
    const { db, tx } = makeDb({ "root-1": "root-1" });

    const quote = await new PostRepository(db).createWithThreadActivity(
      newPost({ id: "quote-1", quoteOf: "root-1" }),
    );

    expect(quote.threadRootId).toBe("quote-1");
    expect(tx.post.findUnique).not.toHaveBeenCalled();
  });

  it("refuses a reply whose parent is gone rather than inventing a root", async () => {
    const { db, tx } = makeDb();

    await expect(
      new PostRepository(db).createWithThreadActivity(
        newPost({ id: "reply-1", replyTo: "missing" }),
      ),
    ).rejects.toThrow(ReplyTargetNotFoundError);
    expect(tx.post.create).not.toHaveBeenCalled();
  });
});
