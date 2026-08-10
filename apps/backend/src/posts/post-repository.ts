import type { Db } from "../persistence/prisma.js";
import type { NewPost, Post } from "./post.js";

type PostRow = {
  id: string;
  simulationId: string;
  authorId: string;
  content: string;
  mentions: string[];
  replyTo: string | null;
  quoteOf: string | null;
  createdAt: Date;
};

function toPost(row: PostRow): Post {
  return {
    id: row.id,
    simulationId: row.simulationId,
    authorId: row.authorId,
    content: row.content,
    mentions: row.mentions,
    replyTo: row.replyTo,
    quoteOf: row.quoteOf,
    createdAt: row.createdAt,
  };
}

export class PostRepository {
  constructor(private readonly db: Db) {}

  async create(input: NewPost): Promise<Post> {
    const row = await this.db.post.create({
      data: {
        simulationId: input.simulationId,
        authorId: input.authorId,
        content: input.content,
        mentions: input.mentions,
        replyTo: input.replyTo ?? null,
        quoteOf: input.quoteOf ?? null,
      },
    });
    return toPost(row);
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
