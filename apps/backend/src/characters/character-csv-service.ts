import type { ExportCharactersCsvResponse, ImportCharactersCsvResponse } from "@brickr/shared";
import { randomUUID } from "node:crypto";
import type { ModelProfileRepository } from "../model-profiles/model-profile-repository.js";
import type { ModelProfile } from "../model-profiles/model-profile.js";
import { CharacterCsvError, exportCharactersCsv, parseCharactersCsv } from "./character-csv.js";
import type { CharacterRepository } from "./character-repository.js";
import type { SaveCharacter } from "./character.js";

/**
 * CSV bulk import/export (CLAUDE.md §50). A sibling of `CharacterService`
 * rather than something it delegates to internally: both methods here go
 * straight to the two repositories and never call any other CharacterService
 * method.
 */
export class CharacterCsvService {
  constructor(
    private readonly characters: CharacterRepository,
    private readonly modelProfiles: ModelProfileRepository,
  ) {}

  async exportCsv(): Promise<ExportCharactersCsvResponse> {
    const [characters, profiles] = await Promise.all([
      this.characters.findAllIncludingDeleted(),
      this.modelProfiles.findAll(),
    ]);
    const postCounts = await this.characters.countPostsByCharacterIds(
      characters.map((character) => character.id),
    );
    return {
      filename: `brickr-characters-${new Date().toISOString().slice(0, 10)}.csv`,
      csv: exportCharactersCsv(
        characters,
        new Map(profiles.map((profile) => [profile.id, profile])),
        postCounts,
      ),
    };
  }

  async importCsv(csv: string): Promise<ImportCharactersCsvResponse> {
    const rows = parseCharactersCsv(csv);
    const [existingCharacters, existingProfiles] = await Promise.all([
      this.characters.findAllIncludingDeleted(),
      this.modelProfiles.findAll(),
    ]);
    const byId = new Map(existingCharacters.map((character) => [character.id, character]));
    const byHandle = new Map(existingCharacters.map((character) => [character.handle, character]));
    const profiles = new Map(existingProfiles.map((profile) => [profile.id, profile]));
    const missingProfiles = new Map<string, ModelProfile>();
    const entries: Array<{ id: string; input: SaveCharacter; isDeleted: boolean }> = [];
    let createdCount = 0;

    for (const row of rows) {
      const idMatch = row.id ? byId.get(row.id) : undefined;
      const handleMatch = byHandle.get(row.handle);
      if (idMatch && handleMatch && idMatch.id !== handleMatch.id) {
        throw new CharacterCsvError(
          `id「${row.id}」とhandle「@${row.handle}」が別の既存キャラクターを指しています。`,
        );
      }
      const existing = idMatch ?? handleMatch;
      const id = existing?.id ?? (row.id || randomUUID());
      if (!existing) createdCount += 1;

      if (!profiles.has(row.modelProfileId) && !missingProfiles.has(row.modelProfileId)) {
        missingProfiles.set(row.modelProfileId, {
          id: row.modelProfileId,
          providerId: row.providerId,
          model: row.model,
        });
      }
      entries.push({
        id,
        isDeleted: row.isDeleted,
        input: {
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
        },
      });
    }

    await this.modelProfiles.ensureAll([...missingProfiles.values()]);
    try {
      await this.characters.importMany(entries);
    } catch (cause) {
      throw new CharacterCsvError("CSVのキャラクターを保存できませんでした。重複するidまたはhandleを確認してください。", { cause });
    }
    return {
      importedCount: entries.length,
      createdCount,
      updatedCount: entries.length - createdCount,
    };
  }
}
