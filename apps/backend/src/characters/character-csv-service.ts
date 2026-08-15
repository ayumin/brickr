import type { ExportCharactersCsvResponse, ImportCharactersCsvResponse } from "@brickr/shared";
import { randomUUID } from "node:crypto";
import type { ModelProfileRepository } from "../model-profiles/model-profile-repository.js";
import type { ModelProfile } from "../model-profiles/model-profile.js";
import { CharacterCsvError, exportCharactersCsv, parseCharactersCsv } from "./character-csv.js";
import type { CharacterActor } from "./character-dto.js";
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

  /** Scoped like the management list it mirrors: your own, everything for an admin (§10.7). */
  async exportCsv(actor: CharacterActor): Promise<ExportCharactersCsvResponse> {
    const [characters, profiles] = await Promise.all([
      actor.isAdmin
        ? this.characters.findAllIncludingDeleted()
        : this.characters.findAllIncludingDeletedByCreatedByUserId(actor.id),
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

  /**
   * Imports characters, creating or updating by id-or-handle match (§10.7).
   *
   * The match is deliberately made against **every** character, not just the
   * caller's: two accounts cannot hold the same handle (§66.13), so narrowing the
   * lookup would turn somebody else's handle into a "new" row and fail on the
   * handle claim instead of saying what is wrong.
   *
   * That is also why the ownership check below exists. Matching by id or handle
   * across the whole table is what made this endpoint the widest hole in the
   * management API: any signed-in caller could rewrite a System seed, or another
   * user's character, by naming its handle in a CSV. A row the caller may not
   * touch now rejects the whole import rather than being skipped, because a
   * partial import that silently ignored half the file would look like it worked.
   */
  async importCsv(
    csv: string,
    actor: CharacterActor,
  ): Promise<ImportCharactersCsvResponse> {
    const rows = parseCharactersCsv(csv);
    const [existingCharacters, existingProfiles] = await Promise.all([
      this.characters.findAllIncludingDeleted(),
      this.modelProfiles.findAll(),
    ]);
    const byId = new Map(existingCharacters.map((character) => [character.id, character]));
    const byHandle = new Map(existingCharacters.map((character) => [character.handle, character]));
    const profiles = new Map(existingProfiles.map((profile) => [profile.id, profile]));
    const missingProfiles = new Map<string, ModelProfile>();
    const entries: Array<{
      id: string;
      input: SaveCharacter;
      isDeleted: boolean;
      createdByUserId: string | null;
    }> = [];
    let createdCount = 0;

    for (const row of rows) {
      const idMatch = row.id ? byId.get(row.id) : undefined;
      const handleMatch = byHandle.get(row.handle);
      if (idMatch && handleMatch && idMatch.id !== handleMatch.id) {
        throw new CharacterCsvError(
          `id「${row.id}」とhandle「@${row.handle}」が別の既存キャストを指しています。`,
        );
      }
      const existing = idMatch ?? handleMatch;
      if (existing && !(actor.isAdmin || existing.createdByUserId === actor.id)) {
        throw new CharacterCsvError(
          `handle「@${row.handle}」は他のユーザーまたはSystemが所有するキャストです。上書きできません。`,
        );
      }
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
        // Only used when the row turns out to be new: an update must never move a
        // character to a different owner, or importing would become a way to take
        // one over.
        createdByUserId: actor.id,
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
      throw new CharacterCsvError("CSVのキャストを保存できませんでした。重複するidまたはhandleを確認してください。", { cause });
    }
    return {
      importedCount: entries.length,
      createdCount,
      updatedCount: entries.length - createdCount,
    };
  }
}
