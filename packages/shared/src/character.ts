/**
 * Character as exposed to the frontend.
 *
 * Deliberately minimal: prompts, probabilities, model profiles and any
 * provider configuration stay on the backend.
 */
export type CharacterDto = {
  id: string;
  handle: string;
  displayName: string;
  description: string;
  avatarUrl?: string;
};

export type CharactersResponse = {
  characters: CharacterDto[];
};
