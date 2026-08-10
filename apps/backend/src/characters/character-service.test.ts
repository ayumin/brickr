import type { SaveCharacterRequest } from "@enjo/shared";
import { describe, expect, it, vi } from "vitest";
import type { ModelProfileRepository } from "../model-profiles/model-profile-repository.js";
import type { ModelProfile } from "../model-profiles/model-profile.js";
import type { CharacterRepository } from "./character-repository.js";
import type {
  CharacterPersonaGenerator,
  GeneratedCharacterPersona,
} from "./character-generator.js";
import {
  CharacterHandleConflictError,
  CharacterGenerationError,
  CharacterNotFoundError,
  CharacterService,
  ModelProfileNotFoundError,
} from "./character-service.js";
import type { Character, SaveCharacter } from "./character.js";

const PROFILE: ModelProfile = {
  id: "anthropic-default",
  providerId: "anthropic",
  model: "test-model",
};

const REQUEST: SaveCharacterRequest = {
  handle: "new_character",
  displayName: "新しいキャラクター",
  description: "新規作成された人格",
  rolePrompt: "現実的な観点から考える。",
  tonePrompt: "短い丁寧語で話す。",
  interests: ["設計", "運用"],
  activityLevel: 0.6,
  responseProbability: 0.7,
  replyProbability: 0.8,
  quoteProbability: 0.2,
  influence: 0.4,
  modelProfileId: PROFILE.id,
};

function makeCharacter(id: string, input: SaveCharacterRequest = REQUEST): Character {
  return { id, ...input };
}

function makeService(
  initial: Character[] = [],
  profiles: ModelProfile[] = [PROFILE],
  generate?: (count: number) => Promise<GeneratedCharacterPersona[]>,
  postCounts: Map<string, number> = new Map(),
) {
  const characters = [...initial];

  const characterRepository = {
    findAll: (): Promise<Character[]> =>
      Promise.resolve(characters.filter((character) => !character.deletedAt)),
    findAllIncludingDeleted: (): Promise<Character[]> => Promise.resolve([...characters]),
    findById: (id: string): Promise<Character | null> =>
      Promise.resolve(
        characters.find((character) => character.id === id && !character.deletedAt) ?? null,
      ),
    findByIdIncludingDeleted: (id: string): Promise<Character | null> =>
      Promise.resolve(characters.find((character) => character.id === id) ?? null),
    findByHandle: (handle: string): Promise<Character | null> =>
      Promise.resolve(characters.find((character) => character.handle === handle) ?? null),
    findByIds: (ids: string[]): Promise<Character[]> =>
      Promise.resolve(
        characters.filter((character) => ids.includes(character.id) && !character.deletedAt),
      ),
    findByIdsIncludingDeleted: (ids: string[]): Promise<Character[]> =>
      Promise.resolve(characters.filter((character) => ids.includes(character.id))),
    countPostsByCharacterIds: (ids: string[]): Promise<Map<string, number>> =>
      Promise.resolve(
        new Map(ids.map((id) => [id, postCounts.get(id) ?? 0])),
      ),
    create: (id: string, input: SaveCharacter): Promise<Character> => {
      const character = { id, ...input };
      characters.push(character);
      return Promise.resolve(character);
    },
    createMany: (
      entries: Array<{ id: string; input: SaveCharacter }>,
    ): Promise<Character[]> => {
      const created = entries.map(({ id, input }) => ({ id, ...input }));
      characters.push(...created);
      return Promise.resolve(created);
    },
    update: (id: string, input: SaveCharacter): Promise<Character> => {
      const index = characters.findIndex((character) => character.id === id);
      const character = { id, ...input };
      characters[index] = character;
      return Promise.resolve(character);
    },
    delete: (id: string): Promise<void> => {
      const index = characters.findIndex((character) => character.id === id);
      if (index >= 0) characters.splice(index, 1);
      return Promise.resolve();
    },
    deleteMany: (ids: string[]): Promise<void> => {
      for (let index = characters.length - 1; index >= 0; index -= 1) {
        if (ids.includes(characters[index]!.id)) characters.splice(index, 1);
      }
      return Promise.resolve();
    },
    restore: (id: string): Promise<void> => {
      const character = characters.find((candidate) => candidate.id === id);
      if (character) delete character.deletedAt;
      return Promise.resolve();
    },
  } as unknown as CharacterRepository;

  const modelProfileRepository = {
    findById: (id: string): Promise<ModelProfile | null> =>
      Promise.resolve(profiles.find((profile) => profile.id === id) ?? null),
    findAll: (): Promise<ModelProfile[]> => Promise.resolve([...profiles]),
  } as unknown as ModelProfileRepository;

  const personaGenerator: CharacterPersonaGenerator = {
    generate: (count) =>
      generate?.(count) ??
      Promise.resolve(
        Array.from({ length: count }, (_, index) => ({
          displayName: `LLM Character ${String(index + 1)}`,
          description: `LLM profile ${String(index + 1)}`,
          rolePrompt: `LLM role ${String(index + 1)}`,
          tonePrompt: `LLM tone ${String(index + 1)}`,
          interests: ["test"],
        })),
      ),
  };

  return {
    service: new CharacterService(
      characterRepository,
      modelProfileRepository,
      personaGenerator,
      () => 0.37,
    ),
    characters,
  };
}

describe("CharacterService", () => {
  it("creates a character with editable persona, behaviour and model profile settings", async () => {
    const { service, characters } = makeService();

    const created = await service.create(REQUEST);

    expect(created.id).toBeTruthy();
    expect(created).toMatchObject(REQUEST);
    expect(characters).toHaveLength(1);
  });

  it("bulk creates LLM personas with unique handles and random behaviour", async () => {
    const { service, characters } = makeService();

    const created = await service.createMany(3);

    expect(created).toHaveLength(3);
    expect(characters).toHaveLength(3);
    expect(new Set(created.map((character) => character.id)).size).toBe(3);
    expect(new Set(created.map((character) => character.handle)).size).toBe(3);
    expect(created[0]).not.toHaveProperty("modelProfileId");
    expect(characters[0]).toMatchObject({
      displayName: "LLM Character 1",
      description: "LLM profile 1",
      rolePrompt: "LLM role 1",
      modelProfileId: PROFILE.id,
      activityLevel: 0.37,
      responseProbability: 0.37,
      replyProbability: 0.37,
      quoteProbability: 0.37,
      influence: 0.37,
    });
  });

  it("does not persist any character when LLM persona generation fails", async () => {
    const { service, characters } = makeService([], [PROFILE], () =>
      Promise.reject(new Error("invalid LLM output")),
    );

    await expect(service.createMany(3)).rejects.toBeInstanceOf(
      CharacterGenerationError,
    );
    expect(characters).toEqual([]);
  });

  it("tracks a background bulk creation job through completion", async () => {
    const { service } = makeService();

    const started = service.startCreateMany(2);

    expect(started).toMatchObject({
      status: "generating",
      completed: 0,
      total: 2,
    });
    await vi.waitFor(() => {
      expect(service.findBulkCreationJob(started.id)).toMatchObject({
        status: "completed",
        completed: 2,
        createdCount: 2,
      });
    });
  });

  it("keeps the underlying generation reason on a failed background job", async () => {
    const { service } = makeService([], [PROFILE], () =>
      Promise.reject(new Error("invalid structured output")),
    );

    const started = service.startCreateMany(2);

    await vi.waitFor(() => {
      expect(service.findBulkCreationJob(started.id)).toMatchObject({
        status: "failed",
        error:
          "キャラクター生成処理でエラーが発生しました: invalid structured output",
      });
    });
  });

  it("updates an existing character without changing its id", async () => {
    const existing = makeCharacter("character-1");
    const { service } = makeService([existing]);

    const updated = await service.update(existing.id, {
      ...REQUEST,
      displayName: "変更後",
      rolePrompt: "変更後の考え方。",
    });

    expect(updated.id).toBe(existing.id);
    expect(updated.displayName).toBe("変更後");
    expect(updated.rolePrompt).toBe("変更後の考え方。");
  });

  it("keeps persona settings out of the lightweight character DTO", async () => {
    const existing = makeCharacter("character-1");
    const { service } = makeService([existing]);

    const publicDto = await service.findDto(existing.id);
    const configDto = await service.findConfigDto(existing.id);

    expect(publicDto).not.toHaveProperty("rolePrompt");
    expect(configDto).toHaveProperty("rolePrompt", REQUEST.rolePrompt);
  });

  it("lists model and behaviour settings without exposing persona prompts", async () => {
    const existing = makeCharacter("character-1");
    const { service } = makeService(
      [existing],
      [PROFILE],
      undefined,
      new Map([[existing.id, 7]]),
    );

    const [managementDto] = await service.listManagementDtos();

    expect(managementDto).toMatchObject({
      id: existing.id,
      isDeleted: false,
      postCount: 7,
      modelProfileId: REQUEST.modelProfileId,
      activityLevel: REQUEST.activityLevel,
      responseProbability: REQUEST.responseProbability,
      replyProbability: REQUEST.replyProbability,
      quoteProbability: REQUEST.quoteProbability,
      influence: REQUEST.influence,
    });
    expect(managementDto).not.toHaveProperty("rolePrompt");
    expect(managementDto).not.toHaveProperty("tonePrompt");
  });

  it("keeps stopped characters out of the public list but includes them in management", async () => {
    const active = makeCharacter("character-active");
    const stopped = {
      ...makeCharacter("character-stopped", { ...REQUEST, handle: "stopped" }),
      deletedAt: new Date("2026-01-01T00:00:00Z"),
    };
    const { service } = makeService([active, stopped]);

    await expect(service.listDtos()).resolves.toHaveLength(1);
    await expect(service.listManagementDtos()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: active.id, isDeleted: false }),
        expect.objectContaining({ id: stopped.id, isDeleted: true }),
      ]),
    );
  });

  it("rejects a handle already used by another character", async () => {
    const existing = makeCharacter("character-1");
    const { service } = makeService([existing]);

    await expect(service.create(REQUEST)).rejects.toBeInstanceOf(
      CharacterHandleConflictError,
    );
  });

  it("rejects an unknown model profile", async () => {
    const { service } = makeService([], []);

    await expect(service.create(REQUEST)).rejects.toBeInstanceOf(
      ModelProfileNotFoundError,
    );
  });

  it("rejects an update for an unknown character", async () => {
    const { service } = makeService();

    await expect(service.update("missing", REQUEST)).rejects.toBeInstanceOf(
      CharacterNotFoundError,
    );
  });

  it("deletes an existing character", async () => {
    const existing = makeCharacter("character-1");
    const { service, characters } = makeService([existing]);

    await expect(service.delete(existing.id)).resolves.toBe(existing.id);
    expect(characters).toEqual([]);
  });

  it("rejects deletion of an unknown character", async () => {
    const { service } = makeService();

    await expect(service.delete("missing")).rejects.toBeInstanceOf(
      CharacterNotFoundError,
    );
  });

  it("restores a logically deleted character", async () => {
    const stopped = {
      ...makeCharacter("character-stopped"),
      deletedAt: new Date("2026-01-01T00:00:00Z"),
    };
    const { service, characters } = makeService([stopped]);

    await expect(service.restore(stopped.id)).resolves.toBe(stopped.id);
    expect(characters[0]?.deletedAt).toBeUndefined();
    await expect(service.listDtos()).resolves.toHaveLength(1);
  });

  it("bulk deletes existing unique ids and ignores missing ids", async () => {
    const first = makeCharacter("character-1");
    const second = makeCharacter("character-2", { ...REQUEST, handle: "second" });
    const { service, characters } = makeService([first, second]);

    await expect(
      service.deleteMany([first.id, first.id, "missing"]),
    ).resolves.toEqual([first.id]);
    expect(characters).toEqual([second]);
  });
});
