import { HandleTakenError } from "./auth-errors.js";
import { hashPassword } from "./password.js";
import type { UserAccountRepository } from "./user-account-repository.js";
import type { UserAccount } from "./user-account.js";

/**
 * Creates the first admin from environment variables (CLAUDE.md §66.9).
 *
 * Invites are single-use and admin-issued, so the very first account has no
 * inviter and must come from outside the invite chain.
 *
 * Idempotent and non-destructive: an existing account is left exactly as it is,
 * so re-running the seed cannot silently reset a password or grant admin.
 */

export type AdminBootstrapOutcome =
  | { status: "skipped"; reason: "not-configured" | "password-missing" }
  | { status: "already-exists"; user: UserAccount }
  | { status: "created"; user: UserAccount };

export type AdminBootstrapConfig = {
  email?: string | undefined;
  password?: string | undefined;
  handle: string;
  displayName: string;
};

export async function bootstrapAdmin(
  users: UserAccountRepository,
  config: AdminBootstrapConfig,
): Promise<AdminBootstrapOutcome> {
  const email = config.email?.trim();
  if (!email) return { status: "skipped", reason: "not-configured" };
  if (!config.password) return { status: "skipped", reason: "password-missing" };

  const existing = await users.findByEmail(email);
  if (existing) return { status: "already-exists", user: existing };

  try {
    const user = await users.createInvited(
      {
        handle: config.handle,
        displayName: config.displayName,
        description: "",
        email,
        passwordHash: await hashPassword(config.password),
        isAdmin: true,
        interests: [],
      },
      // No invite code: this account is the root of the invite chain.
      null,
    );
    return { status: "created", user };
  } catch (error) {
    if (error instanceof HandleTakenError) {
      throw new Error(
        `cannot bootstrap the admin: handle @${config.handle} is already taken. ` +
          "Set ADMIN_HANDLE to a free handle.",
        { cause: error },
      );
    }
    throw error;
  }
}

/** Safe to log: never mentions ADMIN_PASSWORD or its hash (§55). */
export function describeAdminBootstrap(outcome: AdminBootstrapOutcome): string {
  switch (outcome.status) {
    case "created":
      return `created the bootstrap admin @${outcome.user.handle}`;
    case "already-exists":
      return `bootstrap admin already exists (@${outcome.user.handle}), left untouched`;
    case "skipped":
      return outcome.reason === "not-configured"
        ? "ADMIN_EMAIL is not set, skipping admin bootstrap"
        : "ADMIN_EMAIL is set but ADMIN_PASSWORD is empty, skipping admin bootstrap";
  }
}
