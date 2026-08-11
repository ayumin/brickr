import { claimHandle, releaseHandles } from "../handles/handle-claim.js";
import type { Db } from "../persistence/prisma.js";
import type { Character, SaveCharacter } from "./character.js";

/**
 * Interactive transactions default to a 5s budget. Bulk create and CSV import
 * write up to 100 rows plus a handle claim each, which can exceed it.
 */
const BULK_TRANSACTION_TIMEOUT_MS = 60_000;

type CharacterRow = {
  id: string;
  handle: string;
  displayName: string;
  description: string;
  rolePrompt: string;
  tonePrompt: string;
  dialectPrompt: string | null;
  interests: string[];
  activityLevel: number;
  responseProbability: number;
  replyProbability: number;
  quoteProbability: number;
  influence: number;
  modelProfileId: string;
  avatarUrl: string | null;
  deletedAt: Date | null;
};

function toCharacter(row: CharacterRow): Character {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.displayName,
    description: row.description,
    rolePrompt: row.rolePrompt,
    tonePrompt: row.tonePrompt,
    ...(row.dialectPrompt ? { dialectPrompt: row.dialectPrompt } : {}),
    interests: row.interests,
    activityLevel: row.activityLevel,
    responseProbability: row.responseProbability,
    replyProbability: row.replyProbability,
    quoteProbability: row.quoteProbability,
    influence: row.influence,
    modelProfileId: row.modelProfileId,
    ...(row.avatarUrl ? { avatarUrl: row.avatarUrl } : {}),
    ...(row.deletedAt ? { deletedAt: row.deletedAt } : {}),
  };
}

export class CharacterRepository {
  constructor(private readonly db: Db) {}

  async findAll(): Promise<Character[]> {
    const rows = await this.db.character.findMany({
      where: { deletedAt: null },
      orderBy: { id: "asc" },
    });
    return rows.map(toCharacter);
  }

  /** Used when rendering historical posts whose author was later deleted. */
  async findAllIncludingDeleted(): Promise<Character[]> {
    const rows = await this.db.character.findMany({ orderBy: { id: "asc" } });
    return rows.map(toCharacter);
  }

  async findByIdIncludingDeleted(id: string): Promise<Character | null> {
    const row = await this.db.character.findUnique({ where: { id } });
    return row ? toCharacter(row) : null;
  }

  async findById(id: string): Promise<Character | null> {
    const row = await this.db.character.findFirst({
      where: { id, deletedAt: null },
    });
    return row ? toCharacter(row) : null;
  }

  /**
   * `findFirst`, not `findUnique`: the handle column lost its unique index when
   * uniqueness moved to the shared `handles` table (CLAUDE.md §66.13).
   */
  async findByHandle(handle: string): Promise<Character | null> {
    const row = await this.db.character.findFirst({ where: { handle } });
    return row ? toCharacter(row) : null;
  }

  async findByHandles(handles: string[]): Promise<Character[]> {
    if (handles.length === 0) return [];
    const rows = await this.db.character.findMany({
      where: { handle: { in: handles }, deletedAt: null },
    });
    return rows.map(toCharacter);
  }

  async findByIds(ids: string[]): Promise<Character[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.character.findMany({
      where: { id: { in: ids }, deletedAt: null },
    });
    return rows.map(toCharacter);
  }

  async findByIdsIncludingDeleted(ids: string[]): Promise<Character[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.character.findMany({ where: { id: { in: ids } } });
    return rows.map(toCharacter);
  }

  /** Management read-model aggregate; Post.authorId intentionally has no FK. */
  async countPostsByCharacterIds(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db.post.groupBy({
      by: ["authorId"],
      where: { authorId: { in: ids } },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.authorId, row._count._all]));
  }


  /**
   * Creating a character also takes its handle, in one transaction, so the
   * namespace can never drift from the rows it describes (CLAUDE.md §66.13).
   */
  async create(id: string, input: SaveCharacter): Promise<Character> {
    return this.db.$transaction(async (tx) => {
      const row = await tx.character.create({ data: { id, ...toWriteData(input) } });
      await claimHandle(tx, { handle: input.handle, ownerType: "character", ownerId: id });
      return toCharacter(row);
    });
  }

  async createMany(
    entries: Array<{ id: string; input: SaveCharacter }>,
  ): Promise<Character[]> {
    if (entries.length === 0) return [];
    return this.db.$transaction(
      async (tx) => {
        const created: Character[] = [];
        for (const { id, input } of entries) {
          const row = await tx.character.create({ data: { id, ...toWriteData(input) } });
          await claimHandle(tx, { handle: input.handle, ownerType: "character", ownerId: id });
          created.push(toCharacter(row));
        }
        return created;
      },
      { timeout: BULK_TRANSACTION_TIMEOUT_MS },
    );
  }

  /** A rename is the same claim: it releases the old handle and takes the new one. */
  async update(id: string, input: SaveCharacter): Promise<Character> {
    return this.db.$transaction(async (tx) => {
      const row = await tx.character.update({ where: { id }, data: toWriteData(input) });
      await claimHandle(tx, { handle: input.handle, ownerType: "character", ownerId: id });
      return toCharacter(row);
    });
  }

  async delete(id: string): Promise<void> {
    await this.db.character.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async deleteMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.character.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  async restore(id: string): Promise<void> {
    await this.db.character.update({
      where: { id },
      data: { deletedAt: null },
    });
  }

  /**
   * The only path that frees a handle. Soft deletion keeps it reserved, because
   * the character still appears as the author of past posts (§48).
   */
  async hardDeleteMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.$transaction(
      async (tx) => {
        await tx.post.deleteMany({ where: { authorId: { in: ids } } });
        await tx.character.deleteMany({ where: { id: { in: ids } } });
        await releaseHandles(tx, "character", ids);
      },
      { timeout: BULK_TRANSACTION_TIMEOUT_MS },
    );
  }

  async importMany(
    entries: Array<{ id: string; input: SaveCharacter; isDeleted: boolean }>,
  ): Promise<void> {
    if (entries.length === 0) return;
    await this.db.$transaction(
      async (tx) => {
        for (const { id, input, isDeleted } of entries) {
          const data = { ...toWriteData(input), deletedAt: isDeleted ? new Date() : null };
          await tx.character.upsert({ where: { id }, create: { id, ...data }, update: data });
          // An import may rename an existing character, so this has to claim
          // rather than assume the handle is still free.
          await claimHandle(tx, { handle: input.handle, ownerType: "character", ownerId: id });
        }
      },
      { timeout: BULK_TRANSACTION_TIMEOUT_MS },
    );
  }
}

function toWriteData(input: SaveCharacter) {
  return {
    handle: input.handle,
    displayName: input.displayName,
    description: input.description,
    rolePrompt: input.rolePrompt,
    tonePrompt: input.tonePrompt,
    dialectPrompt: input.dialectPrompt ?? null,
    interests: input.interests,
    activityLevel: input.activityLevel,
    responseProbability: input.responseProbability,
    replyProbability: input.replyProbability,
    quoteProbability: input.quoteProbability,
    influence: input.influence,
    modelProfileId: input.modelProfileId,
    avatarUrl: input.avatarUrl ?? null,
  };
}
