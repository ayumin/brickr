import { UserNotFoundError } from "./auth-errors.js";
import type { SessionRepository } from "./session-repository.js";
import type { UserAccountRepository } from "./user-account-repository.js";
import { toPublicAccount, type UserAccount } from "./user-account.js";

/**
 * Admin-only account lifecycle actions (CLAUDE.md §66.7, §66.12).
 *
 * Kept separate from `AuthService`, which is about the signed-in caller's own
 * session: everything here acts on somebody else's account.
 */
export class UserAdminService {
  constructor(
    private readonly users: UserAccountRepository,
    private readonly sessions: SessionRepository,
  ) {}

  /**
   * Suspends an account: blocks future logins, and revokes every existing
   * session so the effect is immediate rather than waiting for expiry (§66.12).
   */
  async suspend(userId: string): Promise<UserAccount> {
    const account = await this.requireAccount(userId);

    await this.users.updateStatus(userId, "suspended");
    await this.sessions.deleteAllForUser(userId);

    return { ...account, status: "suspended" };
  }

  async reactivate(userId: string): Promise<UserAccount> {
    const account = await this.requireAccount(userId);

    await this.users.updateStatus(userId, "active");

    return { ...account, status: "active" };
  }

  private async requireAccount(userId: string): Promise<UserAccount> {
    const account = await this.users.findById(userId);
    if (!account) throw new UserNotFoundError();

    return toPublicAccount(account);
  }
}
