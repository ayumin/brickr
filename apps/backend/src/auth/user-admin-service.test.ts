import { USER_MANAGEMENT_PAGE_SIZE } from "@brickr/shared";
import { describe, expect, it, vi } from "vitest";
import { UserNotFoundError } from "./auth-errors.js";
import { verifyPassword } from "./password.js";
import type { SessionRepository } from "./session-repository.js";
import type { UserAccountRepository } from "./user-account-repository.js";
import type { UserAccountWithSecret } from "./user-account.js";
import { UserAdminService } from "./user-admin-service.js";
import type { RoomService } from "../rooms/room-service.js";

const hanako: UserAccountWithSecret = {
  id: "user-1",
  handle: "hanako",
  displayName: "花子",
  description: "自己紹介",
  email: "hanako@example.com",
  passwordHash: "scrypt$32768$8$1$c2FsdA==$aGFzaA==",
  isAdmin: false,
  status: "active",
  interests: [],
};

const taro: UserAccountWithSecret = {
  id: "user-2",
  handle: "taro",
  displayName: "太郎",
  description: "",
  email: "taro@example.com",
  passwordHash: "scrypt$32768$8$1$c2FsdA==$aGFzaA==",
  isAdmin: true,
  status: "active",
  interests: [],
};

function makeService(
  seed: UserAccountWithSecret[],
  options: {
    rooms?: Pick<RoomService, "archiveOwnedBy">;
    logger?: { error: (obj: Record<string, unknown>, msg: string) => void };
  } = {},
) {
  const accounts = new Map(seed.map((account) => [account.id, account]));
  const sessionsDeletedFor: string[] = [];
  const passwordHashes = new Map<string, string>();

  const users = {
    findById: (id: string) => Promise.resolve(accounts.get(id) ?? null),
    updateStatus: (id: string, status: "active" | "suspended") => {
      const account = accounts.get(id);
      if (account) accounts.set(id, { ...account, status });
      return Promise.resolve();
    },
    updatePasswordHash: (id: string, passwordHash: string) => {
      passwordHashes.set(id, passwordHash);
      const account = accounts.get(id);
      if (account) accounts.set(id, { ...account, passwordHash });
      return Promise.resolve();
    },
    // Mirrors the repository closely enough to exercise search + pagination
    // without a database: substring match, insertion order, sliced by page.
    listManagement: (options: { page: number; pageSize: number; search?: string }) => {
      const search = options.search?.toLowerCase();
      const matches = [...accounts.values()].filter(
        (account) =>
          !search ||
          account.handle.toLowerCase().includes(search) ||
          account.displayName.toLowerCase().includes(search) ||
          account.email.toLowerCase().includes(search),
      );
      const start = (options.page - 1) * options.pageSize;
      return Promise.resolve({
        accounts: matches.slice(start, start + options.pageSize),
        totalCount: matches.length,
      });
    },
  } as unknown as UserAccountRepository;

  const sessions = {
    deleteAllForUser: (userId: string) => {
      sessionsDeletedFor.push(userId);
      return Promise.resolve(0);
    },
  } as unknown as SessionRepository;

  return {
    service: new UserAdminService(users, sessions, options.rooms, options.logger),
    accounts,
    sessionsDeletedFor,
    passwordHashes,
  };
}

describe("UserAdminService.suspend", () => {
  it("flips the account to suspended and revokes every session (§66.12)", async () => {
    const { service, accounts, sessionsDeletedFor } = makeService([hanako]);

    const result = await service.suspend("user-1");

    expect(result.status).toBe("suspended");
    expect(accounts.get("user-1")?.status).toBe("suspended");
    expect(sessionsDeletedFor).toEqual(["user-1"]);
  });

  it("never returns the password hash", async () => {
    const { service } = makeService([hanako]);

    const result = await service.suspend("user-1");

    expect(result).not.toHaveProperty("passwordHash");
  });

  it("throws for an unknown user without touching sessions", async () => {
    const { service, sessionsDeletedFor } = makeService([hanako]);

    await expect(service.suspend("nobody")).rejects.toThrow(UserNotFoundError);
    expect(sessionsDeletedFor).toEqual([]);
  });

  it("reports success and logs when best-effort room archival fails", async () => {
    const archiveError = new Error("database unavailable");
    const rooms = { archiveOwnedBy: vi.fn(() => Promise.reject(archiveError)) };
    const logger = { error: vi.fn() };
    const { service, accounts, sessionsDeletedFor } = makeService([hanako], { rooms, logger });

    await expect(service.suspend("user-1")).resolves.toMatchObject({ status: "suspended" });
    expect(accounts.get("user-1")?.status).toBe("suspended");
    expect(sessionsDeletedFor).toEqual(["user-1"]);
    expect(logger.error).toHaveBeenCalledWith(
      { userId: "user-1", err: "database unavailable" },
      "failed to archive rooms after user suspension",
    );
  });
});

describe("UserAdminService.reactivate", () => {
  it("flips a suspended account back to active", async () => {
    const { service, accounts } = makeService([{ ...hanako, status: "suspended" }]);

    const result = await service.reactivate("user-1");

    expect(result.status).toBe("active");
    expect(accounts.get("user-1")?.status).toBe("active");
  });

  it("throws for an unknown user", async () => {
    const { service } = makeService([hanako]);

    await expect(service.reactivate("nobody")).rejects.toThrow(UserNotFoundError);
  });
});

describe("UserAdminService.listManagement", () => {
  it("uses the fixed §66.15 page size regardless of what the account list holds", async () => {
    const { service } = makeService([hanako, taro]);

    const page = await service.listManagement({ page: 1 });

    expect(page.pageSize).toBe(USER_MANAGEMENT_PAGE_SIZE);
    expect(page.totalCount).toBe(2);
    expect(page.accounts.map((account) => account.handle)).toEqual(["hanako", "taro"]);
  });

  it("filters by handle, display name or email", async () => {
    const { service } = makeService([hanako, taro]);

    await expect(
      service.listManagement({ page: 1, search: "太郎" }).then((page) => page.accounts),
    ).resolves.toEqual([expect.objectContaining({ handle: "taro" })]);

    await expect(
      service.listManagement({ page: 1, search: "hanako@example.com" }).then((page) => page.accounts),
    ).resolves.toEqual([expect.objectContaining({ handle: "hanako" })]);
  });

  it("never returns password hashes", async () => {
    const { service } = makeService([hanako, taro]);

    const page = await service.listManagement({ page: 1 });

    for (const account of page.accounts) expect(account).not.toHaveProperty("passwordHash");
  });

  it("floors a non-positive page to 1", async () => {
    const { service } = makeService([hanako]);

    const page = await service.listManagement({ page: 0 });

    expect(page.page).toBe(1);
  });
});

describe("UserAdminService.resetPassword", () => {
  it("issues a temporary password that verifies against the newly stored hash", async () => {
    const { service, passwordHashes } = makeService([hanako]);

    const { user, temporaryPassword } = await service.resetPassword("user-1");

    expect(user.handle).toBe("hanako");
    const storedHash = passwordHashes.get("user-1");
    await expect(verifyPassword(temporaryPassword, storedHash)).resolves.toBe(true);
  });

  it("revokes all existing sessions for the user", async () => {
    const { service, sessionsDeletedFor } = makeService([hanako]);

    await service.resetPassword("user-1");

    expect(sessionsDeletedFor).toEqual(["user-1"]);
  });

  it("never leaks the password hash in its return value", async () => {
    const { service } = makeService([hanako]);

    const { user } = await service.resetPassword("user-1");

    expect(user).not.toHaveProperty("passwordHash");
  });

  it("throws for an unknown user", async () => {
    const { service } = makeService([hanako]);

    await expect(service.resetPassword("nobody")).rejects.toThrow(UserNotFoundError);
  });
});
