import { describe, expect, it } from "vitest";
import { UserNotFoundError } from "./auth-errors.js";
import type { SessionRepository } from "./session-repository.js";
import type { UserAccountRepository } from "./user-account-repository.js";
import type { UserAccountWithSecret } from "./user-account.js";
import { UserAdminService } from "./user-admin-service.js";

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

function makeService(seed: UserAccountWithSecret[]) {
  const accounts = new Map(seed.map((account) => [account.id, account]));
  const sessionsDeletedFor: string[] = [];

  const users = {
    findById: (id: string) => Promise.resolve(accounts.get(id) ?? null),
    updateStatus: (id: string, status: "active" | "suspended") => {
      const account = accounts.get(id);
      if (account) accounts.set(id, { ...account, status });
      return Promise.resolve();
    },
  } as unknown as UserAccountRepository;

  const sessions = {
    deleteAllForUser: (userId: string) => {
      sessionsDeletedFor.push(userId);
      return Promise.resolve(0);
    },
  } as unknown as SessionRepository;

  return { service: new UserAdminService(users, sessions), accounts, sessionsDeletedFor };
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
