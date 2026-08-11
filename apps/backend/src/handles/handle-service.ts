import type { HandleOwnerDto } from "@brickr/shared";
import type { UserAccountRepository } from "../auth/user-account-repository.js";
import type { CharacterRepository } from "../characters/character-repository.js";
import { toCharacterDto } from "../characters/character-service.js";
import type { HandleRepository } from "./handle-repository.js";

/**
 * Resolves a handle to whoever holds it (CLAUDE.md §66.2, §66.13).
 *
 * The frontend needs this to render `/handle` on a direct visit or a reload,
 * when no simulation has been loaded and there is nothing else to look in.
 */
export class HandleService {
  constructor(
    private readonly handles: HandleRepository,
    private readonly characters: CharacterRepository,
    private readonly users: UserAccountRepository,
  ) {}

  /** Null for an unknown handle, which the route turns into a 404. */
  async resolve(handle: string): Promise<HandleOwnerDto | null> {
    const owner = await this.handles.findByHandle(handle);
    if (!owner) return null;

    if (owner.ownerType === "character") {
      // Soft-deleted characters still resolve. Their handle stays reserved and
      // their past posts keep naming them as the author (§48), so the profile
      // has to remain reachable.
      const character = await this.characters.findByIdIncludingDeleted(owner.ownerId);
      return character
        ? { ownerType: "character", character: toCharacterDto(character) }
        : null;
    }

    const user = await this.users.findById(owner.ownerId);
    if (!user) return null;

    // Built field by field rather than spread: this response is public, so
    // email, isAdmin and status must not travel with it (§66.1).
    return {
      ownerType: "user",
      user: {
        id: user.id,
        handle: user.handle,
        displayName: user.displayName,
        description: user.description,
        ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
      },
    };
  }
}
