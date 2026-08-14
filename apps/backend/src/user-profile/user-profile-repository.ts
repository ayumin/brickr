import { isRecordNotFoundError, type Db } from "../persistence/prisma.js";
import type { SaveUserProfile, UserProfile } from "./user-profile.js";

type UserProfileRow = {
  id: string;
  handle: string | null;
  displayName: string;
  description: string;
  avatarUrl: string | null;
};

/**
 * Every account gets its handle at signup (§66.1), and the seeded pre-login row
 * that used to lack one is gone (§8.2) — but the column is still nullable, so a
 * read has to render something.
 *
 * Whatever it renders has to be shaped like a handle: a profile lives at a bare
 * `/{handle}` (§66.2), and both `GET /api/handles/:handle` and the frontend route
 * accept only `HANDLE_PATTERN`. A raw id is a 36-character UUID with hyphens, so
 * it could never be reached through its own URL. Dropping the hyphens leaves 32
 * lower-case hex characters: a valid handle, derived from the row rather than
 * invented, and one no signup would plausibly hand out. `padEnd` only matters for
 * an id that is not a UUID, where the 3-character floor could otherwise be missed.
 */
function toFallbackHandle(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9_]/gu, "").slice(0, 32).padEnd(3, "0");
}

function toUserProfile(row: UserProfileRow): UserProfile {
  return {
    id: row.id,
    handle: row.handle ?? toFallbackHandle(row.id),
    displayName: row.displayName,
    description: row.description,
    ...(row.avatarUrl ? { avatarUrl: row.avatarUrl } : {}),
  };
}

const SELECT = {
  id: true,
  handle: true,
  displayName: true,
  description: true,
  avatarUrl: true,
} as const;

/**
 * Reads and writes the public half of an account.
 *
 * Rows are created by signup and by the seed, never here: a profile read for an
 * id that does not exist is a miss, not a reason to invent an account.
 */
export class UserProfileRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<UserProfile | null> {
    const row = await this.db.userProfile.findUnique({ where: { id }, select: SELECT });
    return row ? toUserProfile(row) : null;
  }

  /** Batched so mapping a timeline costs one query, not one per post. */
  async findByIds(ids: string[]): Promise<UserProfile[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];

    const rows = await this.db.userProfile.findMany({
      where: { id: { in: unique } },
      select: SELECT,
    });
    return rows.map(toUserProfile);
  }

  /** Mention resolution needs every handle a post could legitimately name. */
  async listHandles(): Promise<string[]> {
    const rows = await this.db.userProfile.findMany({
      where: { handle: { not: null } },
      select: { handle: true },
    });
    return rows.flatMap((row) => (row.handle ? [row.handle] : []));
  }

  async update(id: string, input: SaveUserProfile): Promise<UserProfile | null> {
    try {
      const row = await this.db.userProfile.update({
        where: { id },
        data: {
          displayName: input.displayName,
          description: input.description,
          avatarUrl: input.avatarUrl ?? null,
        },
        select: SELECT,
      });
      return toUserProfile(row);
    } catch (error) {
      if (isRecordNotFoundError(error)) return null;
      throw error;
    }
  }
}
