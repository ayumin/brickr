import type { SaveUserProfileRequest, UserProfileDto } from "@brickr/shared";
import type { UserProfileRepository } from "./user-profile-repository.js";
import type { UserProfile } from "./user-profile.js";

/**
 * The signed-in user's own profile (CLAUDE.md §66.1).
 *
 * Every method takes the id explicitly, so a caller cannot accidentally read or
 * write somebody else's profile by omitting it.
 */
export class UserProfileService {
  constructor(private readonly profiles: UserProfileRepository) {}

  async get(id: string): Promise<UserProfileDto | null> {
    const profile = await this.profiles.findById(id);
    return profile ? toUserProfileDto(profile) : null;
  }

  async update(id: string, input: SaveUserProfileRequest): Promise<UserProfileDto> {
    const profile = await this.profiles.update(id, {
      displayName: input.displayName,
      description: input.description,
      ...(input.avatarUrl ? { avatarUrl: input.avatarUrl } : {}),
    });
    return toUserProfileDto(profile);
  }
}

export function toUserProfileDto(profile: UserProfile): UserProfileDto {
  return {
    id: profile.id,
    // The stored handle, not a constant: there is more than one user now.
    handle: profile.handle,
    displayName: profile.displayName,
    description: profile.description,
    ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
  };
}
