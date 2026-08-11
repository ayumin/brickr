import type { AuthUserDto, UserManagementDto, UserStatus } from "@brickr/shared";

/**
 * Backend domain model for an account (CLAUDE.md §4: distinct from the DTO).
 *
 * `email`, `passwordHash` and `birthdate` stay in this layer. `toAuthUserDto`
 * is the only way out, which is what keeps §66.1's private fields private.
 */
export type UserAccount = {
  id: string;
  handle: string;
  displayName: string;
  description: string;
  avatarUrl?: string;
  email: string;
  isAdmin: boolean;
  status: UserStatus;
  country?: string;
  region?: string;
  interests: string[];
  occupation?: string;
  xHandle?: string;
};

/** Only `AuthService` ever sees this shape. */
export type UserAccountWithSecret = UserAccount & {
  passwordHash: string | null;
};

export type NewUserAccount = {
  handle: string;
  displayName: string;
  description: string;
  email: string;
  passwordHash: string;
  /** Absent only for the env-driven admin bootstrap, which has nobody to ask (§66.9). */
  birthdate?: Date;
  isAdmin: boolean;
  country?: string;
  region?: string;
  interests: string[];
  occupation?: string;
  xHandle?: string;
};

export function toAuthUserDto(account: UserAccount): AuthUserDto {
  return {
    id: account.id,
    handle: account.handle,
    displayName: account.displayName,
    description: account.description,
    ...(account.avatarUrl ? { avatarUrl: account.avatarUrl } : {}),
    isAdmin: account.isAdmin,
    status: account.status,
    ...(account.country ? { country: account.country } : {}),
    ...(account.region ? { region: account.region } : {}),
    interests: account.interests,
    ...(account.occupation ? { occupation: account.occupation } : {}),
    ...(account.xHandle ? { xHandle: account.xHandle } : {}),
  };
}

/** The admin user-management row (§66.15): unlike `toAuthUserDto`, the email is visible. */
export function toUserManagementDto(account: UserAccount): UserManagementDto {
  return {
    id: account.id,
    handle: account.handle,
    displayName: account.displayName,
    ...(account.avatarUrl ? { avatarUrl: account.avatarUrl } : {}),
    email: account.email,
    isAdmin: account.isAdmin,
    status: account.status,
  };
}

export function isSuspended(account: Pick<UserAccount, "status">): boolean {
  return account.status === "suspended";
}

/** Drops the password hash for callers that only need the domain-safe shape. */
export function toPublicAccount(account: UserAccountWithSecret): UserAccount {
  return {
    id: account.id,
    handle: account.handle,
    displayName: account.displayName,
    description: account.description,
    ...(account.avatarUrl ? { avatarUrl: account.avatarUrl } : {}),
    email: account.email,
    isAdmin: account.isAdmin,
    status: account.status,
    ...(account.country ? { country: account.country } : {}),
    ...(account.region ? { region: account.region } : {}),
    interests: account.interests,
    ...(account.occupation ? { occupation: account.occupation } : {}),
    ...(account.xHandle ? { xHandle: account.xHandle } : {}),
  };
}
