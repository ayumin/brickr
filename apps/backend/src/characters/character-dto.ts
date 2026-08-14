import type {
  CharacterConfigDto,
  CharacterCreatorDto,
  CharacterDto,
  CharacterManagementDto,
} from "@brickr/shared";
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

/**
 * No owner id means System-owned (§66.14). A present id with no matching account
 * means that account is gone, which the screen can only show the same way.
 */
function toCreator(
  character: Pick<Character, "createdByUserId">,
  creators: Map<string, CharacterCreatorDto>,
): CharacterCreatorDto | null {
  if (!character.createdByUserId) return null;
  return creators.get(character.createdByUserId) ?? null;
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

/**
 * `creators` is supplied only for the administrator's list — the one list that
 * spans other people's characters (§10.7, §20.3).
 *
 * When it is null the field is omitted rather than sent as null, because null
 * means System-owned and would be a lie about a character the caller owns.
 */
export function toCharacterManagementDto(
  character: Character,
  postCount: number,
  viewer: CharacterActor | null = null,
  creators: Map<string, CharacterCreatorDto> | null = null,
): CharacterManagementDto {
  const ownerVisible = canSeeOwner(character, viewer);
  return {
    ...toCharacterDto(character),
    ...(creators === null ? {} : { creator: toCreator(character, creators) }),
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
