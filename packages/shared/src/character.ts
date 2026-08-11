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
  /** Only present for the creator or an admin (CLAUDE.md §66.5); omitted, not null, otherwise. */
  createdByUserId?: string;
};

/** Settings needed by the character management table, without persona prompts. */
export type CharacterManagementDto = CharacterDto & {
  isDeleted: boolean;
  postCount: number;
  activityLevel: number;
  responseProbability: number;
  replyProbability: number;
  quoteProbability: number;
  influence: number;
  modelProfileId: string;
  /** Only present for the creator or an admin (CLAUDE.md §66.5); omitted, not null, otherwise. */
  createdByUserId?: string;
};

export type CharacterManagementResponse = {
  characters: CharacterManagementDto[];
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

export type DeleteCharacterResponse = {
  deletedId: string;
};

export type RestoreCharacterResponse = {
  restoredId: string;
};

export type CharacterDeletionMode = "soft" | "hard";

export type BulkDeleteCharactersRequest = {
  ids: string[];
  mode?: CharacterDeletionMode;
};

export type BulkDeleteCharactersResponse = {
  deletedIds: string[];
};

export type BulkCreateCharactersRequest = {
  count: number;
};

export type CharacterBulkCreationStatus =
  | "generating"
  | "saving"
  | "completed"
  | "failed";

export type CharacterBulkCreationJobDto = {
  id: string;
  status: CharacterBulkCreationStatus;
  completed: number;
  total: number;
  createdCount: number;
  error?: string;
};

export type CharacterBulkCreationJobResponse = {
  job: CharacterBulkCreationJobDto;
};

export type ExportCharactersCsvResponse = {
  filename: string;
  csv: string;
};

export type ImportCharactersCsvRequest = {
  csv: string;
};

export type ImportCharactersCsvResponse = {
  importedCount: number;
  createdCount: number;
  updatedCount: number;
};

export type ModelProfileDto = {
  id: string;
  providerId: string;
  model: string;
};

export type ModelProfilesResponse = {
  modelProfiles: ModelProfileDto[];
};
