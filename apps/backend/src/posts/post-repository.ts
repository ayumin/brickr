import type { Db, DbTransaction } from "../persistence/prisma.js";
import type { NewPost, Post } from "./post.js";

type PostRow = {
  id: string;
  simulationId: string;
  authorId: string;
  content: string;
  imageUrl: string | null;
  mentions: string[];
  replyTo: string | null;
  quoteOf: string | null;
  threadRootId: string;
  threadActivityAt: Date;
  createdAt: Date;
};

function toPost(row: PostRow): Post {
  return {
    id: row.id,
    simulationId: row.simulationId,
    authorId: row.authorId,
    content: row.content,
    ...(row.imageUrl ? { imageUrl: row.imageUrl } : {}),
    mentions: row.mentions,
    replyTo: row.replyTo,
    quoteOf: row.quoteOf,
    threadRootId: row.threadRootId,
    threadActivityAt: row.threadActivityAt,
    createdAt: row.createdAt,
  };
}

/**
 * A reply whose parent cannot be read back. Callers validate the target before
 * publishing, so this only fires if it disappeared in between — in which case the
 * thread information would be a guess, and inventing a root is worse than failing.
 */
export class ReplyTargetNotFoundError extends Error {
  constructor(id: string) {
    super(`reply target "${id}" not found`);
    this.name = "ReplyTargetNotFoundError";
  }
}

export class PostRepository {
  constructor(private readonly db: Db) {}

  /**
   * Persists a post and the activity timestamps that depend on it, atomically
   * (§8.4).
   *
   * The writes cannot be split: if the post lands but a timestamp does not, the
   * feed orders that thread by a time that no longer matches its posts, and
   * paging past it starts duplicating or skipping threads.
   *
   * The thread root is derived here rather than passed in, so every read and
   * write of the denormalised thread information happens in one transaction on
   * one snapshot. A caller that resolved the root beforehand would need a second
   * lookup of a post it has usually already read, and would still be describing
   * a thread as it looked before the transaction opened.
   *
   * `createdAt` is passed explicitly rather than left to the column default so
   * that `threadActivityAt` is the very same instant, not a few microseconds off.
   */
  async createWithThreadActivity(input: NewPost): Promise<Post> {
    const createdAt = new Date();
    const replyTo = input.replyTo ?? null;

    return this.db.$transaction(async (tx) => {
      // A reply joins its parent's thread however deep the chain runs; anything
      // else — a quote repost included — starts its own (§8.3).
      const threadRootId = replyTo === null ? input.id : await readThreadRootId(tx, replyTo);

      const row = await tx.post.create({
        data: {
          id: input.id,
          simulationId: input.simulationId,
          authorId: input.authorId,
          content: input.content,
          imageUrl: input.imageUrl ?? null,
          mentions: input.mentions,
          replyTo,
          quoteOf: input.quoteOf ?? null,
          threadRootId,
          threadActivityAt: createdAt,
          createdAt,
        },
      });

      // A reply pushes its root back to the top of the feed. A quote repost is
      // its own root, so nothing else moves (§8.3). A root that vanished between
      // the lookup above and here fails this update, taking the insert with it,
      // rather than leaving a post pointing at a thread that is gone.
      if (row.threadRootId !== row.id) {
        await tx.post.update({
          where: { id: row.threadRootId },
          data: { threadActivityAt: createdAt },
        });
      }

      await tx.simulation.update({
        where: { id: row.simulationId },
        data: { lastActivityAt: createdAt },
      });

      return toPost(row);
    });
  }

  async findById(id: string): Promise<Post | null> {
    const row = await this.db.post.findUnique({ where: { id } });
    return row ? toPost(row) : null;
  }

  async findManyByIds(ids: string[]): Promise<Post[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.post.findMany({ where: { id: { in: ids } } });
    return rows.map(toPost);
  }

  /** All posts in a simulation, oldest first. */
  async findBySimulation(simulationId: string): Promise<Post[]> {
    const rows = await this.db.post.findMany({
      where: { simulationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map(toPost);
  }

  /** Most recent posts in a simulation, returned oldest first. */
  async findRecentBySimulation(simulationId: string, limit: number): Promise<Post[]> {
    const rows = await this.db.post.findMany({
      where: { simulationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return rows.reverse().map(toPost);
  }

  /** Direct replies to a post, oldest first. */
  async findReplies(postId: string): Promise<Post[]> {
    const rows = await this.db.post.findMany({
      where: { replyTo: postId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map(toPost);
  }

  /** Posts quoting a post, oldest first. */
  async findQuotes(postId: string): Promise<Post[]> {
    const rows = await this.db.post.findMany({
      where: { quoteOf: postId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map(toPost);
  }

  async countBySimulation(simulationId: string): Promise<number> {
    return this.db.post.count({ where: { simulationId } });
  }
}

/** Only the parent's root is needed, so only that column is read. */
async function readThreadRootId(tx: DbTransaction, replyTo: string): Promise<string> {
  const parent = await tx.post.findUnique({
    where: { id: replyTo },
    select: { threadRootId: true },
  });
  if (!parent) throw new ReplyTargetNotFoundError(replyTo);
  return parent.threadRootId;
}
