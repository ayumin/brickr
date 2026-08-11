import { describe, expect, it } from "vitest";
import { bootstrapAdmin, describeAdminBootstrap } from "./admin-bootstrap.js";
import { HandleTakenError } from "./auth-errors.js";
import { verifyPassword } from "./password.js";
import type { UserAccountRepository } from "./user-account-repository.js";
import { normalizeEmail } from "./user-account-repository.js";
import type { NewUserAccount, UserAccountWithSecret } from "./user-account.js";

function makeUsers(options: { takenHandles?: string[] } = {}) {
  const accounts = new Map<string, UserAccountWithSecret>();
  const handles = new Set(options.takenHandles ?? []);

  const users = {
    findById: (id: string) => Promise.resolve(accounts.get(id) ?? null),
    findByEmail: (email: string) =>
      Promise.resolve(
        [...accounts.values()].find((a) => a.email === normalizeEmail(email)) ?? null,
      ),
    createInvited: (input: NewUserAccount) => {
      if (handles.has(input.handle)) return Promise.reject(new HandleTakenError(input.handle));
      const account: UserAccountWithSecret = {
        id: `user-${accounts.size + 1}`,
        handle: input.handle,
        displayName: input.displayName,
        description: input.description,
        email: normalizeEmail(input.email),
        passwordHash: input.passwordHash,
        isAdmin: input.isAdmin,
        status: "active",
        interests: input.interests,
      };
      handles.add(input.handle);
      accounts.set(account.id, account);
      return Promise.resolve(account);
    },
    updatePasswordHash: () => Promise.resolve(),
  } as unknown as UserAccountRepository;

  return { users, accounts };
}

const config = {
  email: "admin@example.com",
  password: "bootstrap-password",
  handle: "admin",
  displayName: "管理者",
};

describe("bootstrapAdmin", () => {
  it("creates an admin that can sign in with the configured password", async () => {
    const { users, accounts } = makeUsers();

    const outcome = await bootstrapAdmin(users, config);

    expect(outcome.status).toBe("created");
    const created = [...accounts.values()][0];
    expect(created?.isAdmin).toBe(true);
    expect(created?.status).toBe("active");
    await expect(verifyPassword("bootstrap-password", created?.passwordHash)).resolves.toBe(true);
  });

  it("skips when ADMIN_EMAIL is unset instead of failing the seed", async () => {
    const { users, accounts } = makeUsers();

    await expect(bootstrapAdmin(users, { ...config, email: undefined })).resolves.toEqual({
      status: "skipped",
      reason: "not-configured",
    });
    expect(accounts.size).toBe(0);
  });

  it("skips when ADMIN_PASSWORD is empty", async () => {
    const { users } = makeUsers();
    await expect(bootstrapAdmin(users, { ...config, password: "" })).resolves.toEqual({
      status: "skipped",
      reason: "password-missing",
    });
  });

  it("leaves an existing account untouched when the seed runs again", async () => {
    const { users, accounts } = makeUsers();
    await bootstrapAdmin(users, config);
    const before = { ...[...accounts.values()][0] };

    const outcome = await bootstrapAdmin(users, { ...config, password: "a-different-password" });

    expect(outcome.status).toBe("already-exists");
    expect(accounts.size).toBe(1);
    expect([...accounts.values()][0]).toEqual(before);
  });

  it("explains what to change when the admin handle is taken by a character", async () => {
    const { users } = makeUsers({ takenHandles: ["admin"] });
    await expect(bootstrapAdmin(users, config)).rejects.toThrow(/ADMIN_HANDLE/u);
  });
});

describe("describeAdminBootstrap", () => {
  it("never puts the password in the log line (§55)", async () => {
    const { users } = makeUsers();
    const outcome = await bootstrapAdmin(users, config);

    const line = describeAdminBootstrap(outcome);
    expect(line).not.toContain("bootstrap-password");
    expect(line).toContain("@admin");
  });
});
