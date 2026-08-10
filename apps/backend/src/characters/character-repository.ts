import type { Db } from "../persistence/prisma.js";
import type { Character } from "./character.js";

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
    const rows = await this.db.character.findMany({ orderBy: { id: "asc" } });
    return rows.map(toCharacter);
  }

  async findById(id: string): Promise<Character | null> {
    const row = await this.db.character.findUnique({ where: { id } });
    return row ? toCharacter(row) : null;
  }

  async findByHandles(handles: string[]): Promise<Character[]> {
    if (handles.length === 0) return [];
    const rows = await this.db.character.findMany({
      where: { handle: { in: handles } },
    });
    return rows.map(toCharacter);
  }

  async findByIds(ids: string[]): Promise<Character[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.character.findMany({ where: { id: { in: ids } } });
    return rows.map(toCharacter);
  }
}
