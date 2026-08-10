import type {
  CharacterConfigDto,
  CharacterDto,
  SaveCharacterRequest,
} from "@enjo/shared";
import { randomUUID } from "node:crypto";
import type { ModelProfileRepository } from "../model-profiles/model-profile-repository.js";
import type { CharacterRepository } from "./character-repository.js";
import type { Character, SaveCharacter } from "./character.js";

/**
 * Strips the persona and behaviour fields.
 *
 * Ordinary timeline/profile responses stay lightweight. The editor uses the
 * separate config DTO below; provider credentials are never included.
 */
export function toCharacterDto(character: Character): CharacterDto {
  return {
    id: character.id,
    handle: character.handle,
    displayName: character.displayName,
    description: character.description,
    ...(character.avatarUrl ? { avatarUrl: character.avatarUrl } : {}),
  };
}

export function toCharacterConfigDto(character: Character): CharacterConfigDto {
  return {
    ...toCharacterDto(character),
    rolePrompt: character.rolePrompt,
    tonePrompt: character.tonePrompt,
    ...(character.dialectPrompt ? { dialectPrompt: character.dialectPrompt } : {}),
    interests: character.interests,
    activityLevel: character.activityLevel,
    responseProbability: character.responseProbability,
    replyProbability: character.replyProbability,
    quoteProbability: character.quoteProbability,
    influence: character.influence,
    modelProfileId: character.modelProfileId,
  };
}

export class CharacterNotFoundError extends Error {
  constructor(id: string) {
    super(`character "${id}" not found`);
    this.name = "CharacterNotFoundError";
  }
}

export class CharacterHandleConflictError extends Error {
  constructor(handle: string) {
    super(`handle "@${handle}" is already in use`);
    this.name = "CharacterHandleConflictError";
  }
}

export class ModelProfileNotFoundError extends Error {
  constructor(id: string) {
    super(`model profile "${id}" not found`);
    this.name = "ModelProfileNotFoundError";
  }
}

export class CharacterService {
  constructor(
    private readonly characters: CharacterRepository,
    private readonly modelProfiles: ModelProfileRepository,
  ) {}

  async listDtos(): Promise<CharacterDto[]> {
    const all = await this.characters.findAll();
    return all.map(toCharacterDto);
  }

  async findDto(id: string): Promise<CharacterDto | null> {
    const character = await this.characters.findById(id);
    return character ? toCharacterDto(character) : null;
  }

  async findConfigDto(id: string): Promise<CharacterConfigDto | null> {
    const character = await this.characters.findById(id);
    return character ? toCharacterConfigDto(character) : null;
  }

  async create(input: SaveCharacterRequest): Promise<CharacterConfigDto> {
    await this.assertModelProfile(input.modelProfileId);
    await this.assertHandleAvailable(input.handle);
    const character = await this.characters.create(randomUUID(), toSaveCharacter(input));
    return toCharacterConfigDto(character);
  }

  async update(id: string, input: SaveCharacterRequest): Promise<CharacterConfigDto> {
    const existing = await this.characters.findById(id);
    if (!existing) throw new CharacterNotFoundError(id);

    await this.assertModelProfile(input.modelProfileId);
    await this.assertHandleAvailable(input.handle, id);
    const character = await this.characters.update(id, toSaveCharacter(input));
    return toCharacterConfigDto(character);
  }

  private async assertModelProfile(id: string): Promise<void> {
    if (!(await this.modelProfiles.findById(id))) throw new ModelProfileNotFoundError(id);
  }

  private async assertHandleAvailable(handle: string, currentId?: string): Promise<void> {
    const existing = await this.characters.findByHandle(handle);
    if (existing && existing.id !== currentId) throw new CharacterHandleConflictError(handle);
  }
}

function toSaveCharacter(input: SaveCharacterRequest): SaveCharacter {
  return {
    handle: input.handle,
    displayName: input.displayName,
    description: input.description,
    rolePrompt: input.rolePrompt,
    tonePrompt: input.tonePrompt,
    ...(input.dialectPrompt ? { dialectPrompt: input.dialectPrompt } : {}),
    interests: input.interests,
    activityLevel: input.activityLevel,
    responseProbability: input.responseProbability,
    replyProbability: input.replyProbability,
    quoteProbability: input.quoteProbability,
    influence: input.influence,
    modelProfileId: input.modelProfileId,
    ...(input.avatarUrl ? { avatarUrl: input.avatarUrl } : {}),
  };
}
