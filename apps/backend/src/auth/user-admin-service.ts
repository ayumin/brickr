import { USER_MANAGEMENT_PAGE_SIZE } from "@brickr/shared";
import { UserNotFoundError } from "./auth-errors.js";
import { generateTemporaryPassword, hashPassword } from "./password.js";
import type { SessionRepository } from "./session-repository.js";
import type { UserAccountRepository } from "./user-account-repository.js";
import { toPublicAccount, type UserAccount } from "./user-account.js";

export type UserManagementPage = {
  accounts: UserAccount[];
  page: number;
  pageSize: number;
  totalCount: number;
};

/**
 * Admin-only account lifecycle actions (CLAUDE.md §66.7, §66.12, §66.15).
 *
 * Kept separate from `AuthService`, which is about the signed-in caller's own
 * session: everything here acts on somebody else's account.
 */
export class UserAdminService {
  constructor(
    private readonly users: UserAccountRepository,
    private readonly sessions: SessionRepository,
  ) {}

  async findById(userId: string): Promise<UserAccount | null> {
    const account = await this.users.findById(userId);
    return account ? toPublicAccount(account) : null;
  }

  /** 1-based `page`, capped to the fixed §66.15 page size regardless of what is asked for. */
  async listManagement(options: { page: number; search?: string }): Promise<UserManagementPage> {
    const page = Math.max(1, Math.trunc(options.page));
    const { accounts, totalCount } = await this.users.listManagement({
      page,
      pageSize: USER_MANAGEMENT_PAGE_SIZE,
      ...(options.search ? { search: options.search } : {}),
    });

    return {
      accounts: accounts.map(toPublicAccount),
      page,
      pageSize: USER_MANAGEMENT_PAGE_SIZE,
      totalCount,
    };
  }

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

  /**
   * Issues a temporary password in lieu of self-service reset (§66.10). Returned
   * once, in clear text, for the admin to relay to the user out of band — never
   * logged, never stored anywhere but this response. Existing sessions are revoked
   * immediately so that a compromised account cannot remain active after the reset.
   */
  async resetPassword(userId: string): Promise<{ user: UserAccount; temporaryPassword: string }> {
    const user = await this.requireAccount(userId);

    const temporaryPassword = generateTemporaryPassword();
    await this.users.updatePasswordHash(userId, await hashPassword(temporaryPassword));
    await this.sessions.deleteAllForUser(userId);

    return { user, temporaryPassword };
  }

  private async requireAccount(userId: string): Promise<UserAccount> {
    const account = await this.users.findById(userId);
    if (!account) throw new UserNotFoundError();

    return toPublicAccount(account);
  }
}
