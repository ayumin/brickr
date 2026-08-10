export type UserProfileDto = {
  id: string;
  handle: string;
  displayName: string;
  description: string;
  avatarUrl?: string;
};

export type SaveUserProfileRequest = {
  displayName: string;
  description: string;
  avatarUrl?: string;
};

export type UserProfileResponse = {
  profile: UserProfileDto;
};
