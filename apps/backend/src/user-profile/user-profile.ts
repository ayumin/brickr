export type UserProfile = {
  id: string;
  displayName: string;
  description: string;
  avatarUrl?: string;
};

export type SaveUserProfile = Omit<UserProfile, "id">;
