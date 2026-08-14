import type { Db } from "../persistence/prisma.js";
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

export class PostRepository {
  constructor(private readonly db: Db) {}

  /**
   * Persists a post and the activity timestamps that depend on it, atomically
   * (§8.4).
   *
   * The three writes cannot be split: if the post lands but a timestamp does
   * not, the feed orders that thread by a time that no longer matches its posts,
   * and paging past it starts duplicating or skipping threads.
   *
   * `createdAt` is passed explicitly rather than left to the column default so
   * that `threadActivityAt` is the very same instant, not a few microseconds off.
   */
  async createWithThreadActivity(input: NewPost): Promise<Post> {
    const createdAt = new Date();

    return this.db.$transaction(async (tx) => {
      const row = await tx.post.create({
        data: {
          id: input.id,
          simulationId: input.simulationId,
          authorId: input.authorId,
          content: input.content,
          imageUrl: input.imageUrl ?? null,
          mentions: input.mentions,
          replyTo: input.replyTo ?? null,
          quoteOf: input.quoteOf ?? null,
          threadRootId: input.threadRootId,
          threadActivityAt: createdAt,
          createdAt,
        },
      });

      // A reply pushes its root back to the top of the feed. A quote repost is
      // its own root, so nothing else moves (§8.3).
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
