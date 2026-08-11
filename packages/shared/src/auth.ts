import type { CharacterManagementDto } from "./character.js";

/**
 * Authentication contract shared between frontend and backend (CLAUDE.md §66).
 *
 * DTOs only. Email and birthdate are private (§66.1) and never leave the
 * backend, so they are absent from every response type below.
 */

/** Opaque session cookie. The SSE endpoint authenticates with the same one (§66.11). */
export const SESSION_COOKIE_NAME = "brickr_session";

/** Signup is refused below this age (§66.1). Self-declared, never verified (§66.10). */
export const MIN_SIGNUP_AGE_YEARS = 18;

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

/** Handles live in one namespace shared with characters (§66.13). */
export const HANDLE_PATTERN = "^[a-z0-9_]{1,32}$";

export type UserStatus = "active" | "suspended";

/** Owner kinds of the shared handle namespace (§66.13). */
export type HandleOwnerType = "user" | "character";

/** The signed-in user as seen by the frontend. */
export type AuthUserDto = {
  id: string;
  handle: string;
  displayName: string;
  description: string;
  avatarUrl?: string;
  isAdmin: boolean;
  status: UserStatus;
  country?: string;
  region?: string;
  interests: string[];
  occupation?: string;
  xHandle?: string;
};

export type SignupRequest = {
  inviteCode: string;
  email: string;
  password: string;
  handle: string;
  displayName: string;
  /** ISO calendar date, `YYYY-MM-DD`. Stored, never returned. */
  birthdate: string;
  description?: string;
  country?: string;
  region?: string;
  interests?: string[];
  occupation?: string;
  xHandle?: string;
};

export type LoginRequest = {
  email: string;
  password: string;
};

export type AuthUserResponse = {
  user: AuthUserDto;
};

/** `null` while signed out, so the frontend can bootstrap without a 401 round trip. */
export type SessionResponse = {
  user: AuthUserDto | null;
};

/** Admin user-management table (§66.7, §66.15), same page size as Character management (§48). */
export const USER_MANAGEMENT_PAGE_SIZE = 100;

/** Row shape for the admin user-management table. Distinct from `AuthUserDto`: an admin sees the email too. */
export type UserManagementDto = {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl?: string;
  email: string;
  isAdmin: boolean;
  status: UserStatus;
};

export type UserManagementResponse = {
  users: UserManagementDto[];
  page: number;
  pageSize: number;
  totalCount: number;
};

export type UserDetailResponse = {
  user: UserManagementDto;
};

/** The temporary password is returned once, for the admin to relay out of band (§66.10). */
export type ResetPasswordResponse = {
  temporaryPassword: string;
};

/** Characters this account created, including its deleted ones (§66.5). */
export type UserCharactersResponse = {
  characters: CharacterManagementDto[];
};

/** Zeroed, not omitted, for a user who has never triggered a generation (§66.4). */
export type UserTokenUsageResponse = {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
};

/** Derived from `usedById`/`expiresAt`, not stored — one less thing that can drift (§66.9). */
export type InviteCodeStatus = "unused" | "used" | "expired";

/** Admin-only view of an invite code (§66.9, §66.15). The code itself is never hashed. */
export type InviteCodeDto = {
  code: string;
  issuedById: string;
  usedById?: string;
  usedAt?: string;
  expiresAt?: string;
  createdAt: string;
  status: InviteCodeStatus;
};

export type CreateInviteCodeRequest = {
  /** Omit for a code that never expires. */
  expiresInDays?: number;
};

export type CreateInviteCodeResponse = {
  inviteCode: InviteCodeDto;
};

export type InviteCodesResponse = {
  inviteCodes: InviteCodeDto[];
};
