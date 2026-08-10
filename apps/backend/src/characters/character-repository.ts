import type { Db } from "../persistence/prisma.js";
import type { Character, SaveCharacter } from "./character.js";

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

  async findById(id: string): Promise<Character | null> {
    const row = await this.db.character.findFirst({
      where: { id, deletedAt: null },
    });
    return row ? toCharacter(row) : null;
  }

  async findByHandle(handle: string): Promise<Character | null> {
    const row = await this.db.character.findUnique({ where: { handle } });
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


  async create(id: string, input: SaveCharacter): Promise<Character> {
    const row = await this.db.character.create({
      data: { id, ...toWriteData(input) },
    });
    return toCharacter(row);
  }

  async createMany(
    entries: Array<{ id: string; input: SaveCharacter }>,
  ): Promise<Character[]> {
    if (entries.length === 0) return [];
    const rows = await this.db.$transaction(
      entries.map(({ id, input }) =>
        this.db.character.create({
          data: { id, ...toWriteData(input) },
        }),
      ),
    );
    return rows.map(toCharacter);
  }

  async update(id: string, input: SaveCharacter): Promise<Character> {
    const row = await this.db.character.update({
      where: { id },
      data: toWriteData(input),
    });
    return toCharacter(row);
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
