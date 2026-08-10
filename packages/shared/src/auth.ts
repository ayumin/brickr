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
