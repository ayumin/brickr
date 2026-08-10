import type { CharacterDto } from "@enjo/shared";
import type { CharacterRepository } from "./character-repository.js";
import type { Character } from "./character.js";

/**
 * Strips the persona and behaviour fields.
 *
 * Prompts, probabilities, model profiles and provider config must never reach
 * the frontend (CLAUDE.md §47).
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

export class CharacterService {
  constructor(private readonly characters: CharacterRepository) {}

  async listDtos(): Promise<CharacterDto[]> {
    const all = await this.characters.findAll();
    return all.map(toCharacterDto);
  }

  async findDto(id: string): Promise<CharacterDto | null> {
    const character = await this.characters.findById(id);
    return character ? toCharacterDto(character) : null;
  }
}
