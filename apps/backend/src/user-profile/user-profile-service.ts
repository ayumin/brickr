import {
  USER_HANDLE,
  type SaveUserProfileRequest,
  type UserProfileDto,
} from "@enjo/shared";
import type { UserProfileRepository } from "./user-profile-repository.js";
import type { UserProfile } from "./user-profile.js";

export class UserProfileService {
  constructor(private readonly profiles: UserProfileRepository) {}

  async get(): Promise<UserProfileDto> {
    return toUserProfileDto(await this.profiles.get());
  }

  async update(input: SaveUserProfileRequest): Promise<UserProfileDto> {
    const profile = await this.profiles.update({
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
    handle: USER_HANDLE,
    displayName: profile.displayName,
    description: profile.description,
    ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
  };
}
