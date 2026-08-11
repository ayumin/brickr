/**
 * Backend domain model for an account's public profile.
 *
 * `handle` is set once at signup and never editable (CLAUDE.md §66.1), which is
 * why `SaveUserProfile` leaves it out.
 */
export type UserProfile = {
  id: string;
  handle: string;
  displayName: string;
  description: string;
  avatarUrl?: string;
};

export type SaveUserProfile = Omit<UserProfile, "id" | "handle">;
