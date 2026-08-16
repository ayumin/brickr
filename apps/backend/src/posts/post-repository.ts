import { DomainError } from "../domain-error.js";
import { Prisma, type Db, type DbTransaction } from "../persistence/prisma.js";
import { optionalField } from "../persistence/repository-mapping.js";
import type { NewPost, Post } from "./post.js";

/**
 * Also used by the feed repository, which reads posts through its own queries but
 * must produce the identical domain object — its raw rows are aliased to these
 * exact names so both sides share one mapper.
 */
export type PostRow = {
  id: string;
  roomId: string;
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

export function toPost(row: PostRow): Post {
  return {
    id: row.id,
    simulationId: row.roomId,
    authorId: row.authorId,
    content: row.content,
    ...optionalField("imageUrl", row.imageUrl),
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
export class ReplyTargetNotFoundError extends DomainError {
  readonly httpStatus = 404;
  readonly errorCode = "not_found" as const;
  constructor(id: string) {
    super(`reply target "${id}" not found`);
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
          roomId: input.simulationId,
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

      await tx.room.update({
        where: { id: row.roomId },
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

  /** All posts in a simulation (room), oldest first. */
  async findBySimulation(simulationId: string): Promise<Post[]> {
    return this.queryPosts({ roomId: simulationId }, "asc");
  }

  /** Most recent posts in a simulation (room), returned oldest first. */
  async findRecentBySimulation(simulationId: string, limit: number): Promise<Post[]> {
    return this.queryPosts({ roomId: simulationId }, "desc", limit);
  }

  /** Direct replies to a post, oldest first. */
  async findReplies(postId: string): Promise<Post[]> {
    return this.queryPosts({ replyTo: postId }, "asc");
  }

  /** Posts quoting a post, oldest first. */
  async findQuotes(postId: string): Promise<Post[]> {
    return this.queryPosts({ quoteOf: postId }, "asc");
  }

  async countBySimulation(simulationId: string): Promise<number> {
    return this.db.post.count({ where: { roomId: simulationId } });
  }

  /**
   * `limit` also flips the sort to newest-first so the database can serve it
   * with an index, then the result is reversed back to the oldest-first order
   * every caller expects.
   */
  private async queryPosts(
    where: Prisma.PostWhereInput,
    order: "asc" | "desc",
    limit?: number,
  ): Promise<Post[]> {
    const rows = await this.db.post.findMany({
      where,
      orderBy: [{ createdAt: order }, { id: order }],
      ...(limit === undefined ? {} : { take: limit }),
    });
    return (limit === undefined ? rows : rows.reverse()).map(toPost);
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
