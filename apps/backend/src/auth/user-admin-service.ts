import { USER_MANAGEMENT_PAGE_SIZE } from "@brickr/shared";
import { UserNotFoundError } from "./auth-errors.js";
import { generateTemporaryPassword, hashPassword } from "./password.js";
import type { SessionRepository } from "./session-repository.js";
import type { UserAccountRepository } from "./user-account-repository.js";
import { toPublicAccount, type UserAccount } from "./user-account.js";
import type { RoomService } from "../simulation/room-service.js";

export type UserManagementPage = {
  accounts: UserAccount[];
  page: number;
  pageSize: number;
  totalCount: number;
};

export type UserAdminLogger = {
  error: (obj: Record<string, unknown>, msg: string) => void;
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
    /** Optional: when provided, suspending a user also archives their owned rooms (issue #151). */
    private readonly rooms?: Pick<RoomService, "archiveOwnedBy">,
    private readonly logger?: UserAdminLogger,
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
   * Suspends an account: blocks future logins, revokes every existing session,
   * and archives all rooms the user owns (issue #151 — owner deactivation rule).
   */
  async suspend(userId: string): Promise<UserAccount> {
    const account = await this.requireAccount(userId);

    await this.users.updateStatus(userId, "suspended");
    await this.sessions.deleteAllForUser(userId);

    // Archive owned rooms so they do not remain active without an owner (§151).
    // This is best-effort: a failure here does not roll back the suspension.
    if (this.rooms) {
      try {
        await this.rooms.archiveOwnedBy(userId);
      } catch (error) {
        this.logger?.error(
          { userId, err: error instanceof Error ? error.message : String(error) },
          "failed to archive rooms after user suspension",
        );
      }
    }

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
