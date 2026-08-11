import { USER_HANDLE } from "@brickr/shared";
import type { Db } from "../persistence/prisma.js";
import type { SaveUserProfile, UserProfile } from "./user-profile.js";

type UserProfileRow = {
  id: string;
  handle: string | null;
  displayName: string;
  description: string;
  avatarUrl: string | null;
};

function toUserProfile(row: UserProfileRow): UserProfile {
  return {
    id: row.id,
    // Only the pre-login row can lack a handle, and the seed backfills it to
    // `you`. Falling back keeps an un-seeded database renderable.
    handle: row.handle ?? USER_HANDLE,
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

  async update(id: string, input: SaveUserProfile): Promise<UserProfile> {
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
  }
}
