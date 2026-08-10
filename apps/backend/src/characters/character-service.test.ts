import type { SaveCharacterRequest } from "@enjo/shared";
import { describe, expect, it } from "vitest";
import type { ModelProfileRepository } from "../model-profiles/model-profile-repository.js";
import type { ModelProfile } from "../model-profiles/model-profile.js";
import type { CharacterRepository } from "./character-repository.js";
import {
  CharacterHandleConflictError,
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

function makeService(initial: Character[] = [], profiles: ModelProfile[] = [PROFILE]) {
  const characters = [...initial];

  const characterRepository = {
    findAll: (): Promise<Character[]> => Promise.resolve([...characters]),
    findById: (id: string): Promise<Character | null> =>
      Promise.resolve(characters.find((character) => character.id === id) ?? null),
    findByHandle: (handle: string): Promise<Character | null> =>
      Promise.resolve(characters.find((character) => character.handle === handle) ?? null),
    create: (id: string, input: SaveCharacter): Promise<Character> => {
      const character = { id, ...input };
      characters.push(character);
      return Promise.resolve(character);
    },
    update: (id: string, input: SaveCharacter): Promise<Character> => {
      const index = characters.findIndex((character) => character.id === id);
      const character = { id, ...input };
      characters[index] = character;
      return Promise.resolve(character);
    },
  } as unknown as CharacterRepository;

  const modelProfileRepository = {
    findById: (id: string): Promise<ModelProfile | null> =>
      Promise.resolve(profiles.find((profile) => profile.id === id) ?? null),
  } as unknown as ModelProfileRepository;

  return {
    service: new CharacterService(characterRepository, modelProfileRepository),
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
});
