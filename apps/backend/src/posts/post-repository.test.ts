import { describe, expect, it, vi } from "vitest";
import type { Db, DbTransaction } from "../persistence/prisma.js";
import { PostRepository } from "./post-repository.js";
import type { NewPost } from "./post.js";

function makeDb() {
  const tx = {
    post: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ imageUrl: null, ...data }),
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
    threadRootId: overrides.id,
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
    const { db, tx } = makeDb();

    const reply = await new PostRepository(db).createWithThreadActivity(
      newPost({ id: "reply-1", replyTo: "root-1", threadRootId: "root-1" }),
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
