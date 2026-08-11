import type { Db } from "../persistence/prisma.js";

export type StoredSession = {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
};

/**
 * Sessions live in Postgres, not Redis (CLAUDE.md §66.11, §60).
 *
 * Rows are keyed by the token digest, so nothing here can reconstruct a cookie.
 */
export class SessionRepository {
  constructor(private readonly db: Db) {}

  async create(session: StoredSession): Promise<void> {
    await this.db.session.create({ data: session });
  }

  /** Returns null for expired rows and deletes them on the way past. */
  async findValid(tokenHash: string, now: Date = new Date()): Promise<StoredSession | null> {
    const row = await this.db.session.findUnique({ where: { tokenHash } });
    if (!row) return null;

    if (row.expiresAt.getTime() <= now.getTime()) {
      await this.deleteByTokenHash(tokenHash);
      return null;
    }
    return { tokenHash: row.tokenHash, userId: row.userId, expiresAt: row.expiresAt };
  }

  async deleteByTokenHash(tokenHash: string): Promise<void> {
    await this.db.session.deleteMany({ where: { tokenHash } });
  }

  /** Suspend revokes every session at once (§66.12). */
  async deleteAllForUser(userId: string): Promise<number> {
    const { count } = await this.db.session.deleteMany({ where: { userId } });
    return count;
  }

  async deleteExpired(now: Date = new Date()): Promise<number> {
    const { count } = await this.db.session.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    return count;
  }
}
