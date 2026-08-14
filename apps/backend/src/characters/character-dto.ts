import type { CharacterConfigDto, CharacterDto, CharacterManagementDto } from "@brickr/shared";
import type { UserAccount } from "../auth/user-account.js";
import type { Character } from "./character.js";

/** The signed-in caller, reduced to what an ownership check needs (CLAUDE.md §66.5). */
export type CharacterActor = Pick<UserAccount, "id" | "isAdmin">;

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

/**
 * Whether `createdByUserId` may be shown to this viewer: the creator or an
 * admin — never anyone else, and never for a System-owned (seed) character,
 * which has none (CLAUDE.md §66.5).
 */
function canSeeOwner(
  character: Pick<Character, "createdByUserId">,
  viewer: CharacterActor | null,
): boolean {
  return viewer !== null && (viewer.isAdmin || viewer.id === character.createdByUserId);
}

export function toCharacterConfigDto(
  character: Character,
  viewer: CharacterActor | null,
): CharacterConfigDto {
  const ownerVisible = canSeeOwner(character, viewer);
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
    ...(ownerVisible && character.createdByUserId
      ? { createdByUserId: character.createdByUserId }
      : {}),
  };
}

export function toCharacterManagementDto(
  character: Character,
  postCount: number,
  viewer: CharacterActor | null = null,
): CharacterManagementDto {
  const ownerVisible = canSeeOwner(character, viewer);
  return {
    ...toCharacterDto(character),
    isDeleted: Boolean(character.deletedAt),
    postCount,
    activityLevel: character.activityLevel,
    responseProbability: character.responseProbability,
    replyProbability: character.replyProbability,
    quoteProbability: character.quoteProbability,
    influence: character.influence,
    modelProfileId: character.modelProfileId,
    ...(ownerVisible && character.createdByUserId
      ? { createdByUserId: character.createdByUserId }
      : {}),
  };
}
