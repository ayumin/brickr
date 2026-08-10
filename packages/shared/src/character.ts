/**
 * Character as exposed to the frontend.
 *
 * Deliberately minimal: prompts and behaviour are loaded only by the separate
 * editor config API, not by ordinary timeline/profile requests.
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

/** Internal character settings exposed only by the character editor API. */
export type CharacterConfigDto = CharacterDto & {
  rolePrompt: string;
  tonePrompt: string;
  dialectPrompt?: string;
  interests: string[];
  activityLevel: number;
  responseProbability: number;
  replyProbability: number;
  quoteProbability: number;
  influence: number;
  modelProfileId: string;
};

export type SaveCharacterRequest = {
  handle: string;
  displayName: string;
  description: string;
  rolePrompt: string;
  tonePrompt: string;
  dialectPrompt?: string;
  interests: string[];
  activityLevel: number;
  responseProbability: number;
  replyProbability: number;
  quoteProbability: number;
  influence: number;
  modelProfileId: string;
  avatarUrl?: string;
};

export type CharacterConfigResponse = {
  character: CharacterConfigDto;
};

export type ModelProfileDto = {
  id: string;
  providerId: string;
  model: string;
};

export type ModelProfilesResponse = {
  modelProfiles: ModelProfileDto[];
};
