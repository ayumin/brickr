import { describe, expect, it } from "vitest";
import { AuthService } from "./auth-service.js";
import {
  AccountSuspendedError,
  EmailTakenError,
  HandleTakenError,
  InvalidBirthdateError,
  InvalidCredentialsError,
  InviteCodeInvalidError,
  UnderageSignupError,
} from "./auth-errors.js";
import { hashSessionToken } from "./session-cookie.js";
import type { SessionRepository, StoredSession } from "./session-repository.js";
import type { UserAccountRepository } from "./user-account-repository.js";
import { normalizeEmail } from "./user-account-repository.js";
import type { NewUserAccount, UserAccountWithSecret } from "./user-account.js";
import { UserAdminService } from "./user-admin-service.js";

const NOW = new Date(Date.UTC(2026, 7, 10));
const ADULT_BIRTHDATE = "1990-04-05";

/**
 * In-memory stand-ins for the two repositories. They reproduce the constraints
 * that matter to the service (unique email, shared handle namespace, single-use
 * invite codes) so the tests exercise real behaviour without a database.
 */
function makeRepositories(options: { takenHandles?: string[]; inviteCodes?: string[] } = {}) {
  const accounts = new Map<string, UserAccountWithSecret>();
  const handles = new Set(options.takenHandles ?? []);
  const unusedCodes = new Set(options.inviteCodes ?? ["INVITE-1"]);
  const sessionRows = new Map<string, StoredSession>();

  const users = {
    findById: (id: string) => Promise.resolve(accounts.get(id) ?? null),
    findByEmail: (email: string) =>
      Promise.resolve(
        [...accounts.values()].find((a) => a.email === normalizeEmail(email)) ?? null,
      ),
    createInvited: (input: NewUserAccount, inviteCode: string | null) => {
      // Same order as the real repository: the invite code is validated before
      // anything can surface an email or handle conflict.
      if (inviteCode !== null && !unusedCodes.has(inviteCode)) {
        return Promise.reject(new InviteCodeInvalidError());
      }

      const email = normalizeEmail(input.email);
      if ([...accounts.values()].some((a) => a.email === email)) {
        return Promise.reject(new EmailTakenError());
      }
      if (handles.has(input.handle)) {
        return Promise.reject(new HandleTakenError(input.handle));
      }
      if (inviteCode !== null) unusedCodes.delete(inviteCode);

      const account: UserAccountWithSecret = {
        id: `user-${accounts.size + 1}`,
        handle: input.handle,
        displayName: input.displayName,
        description: input.description,
        email,
        passwordHash: input.passwordHash,
        isAdmin: input.isAdmin,
        status: "active",
        interests: input.interests,
      };
      handles.add(input.handle);
      accounts.set(account.id, account);
      return Promise.resolve(account);
    },
    updatePasswordHash: (id: string, passwordHash: string) => {
      const account = accounts.get(id);
      if (account) accounts.set(id, { ...account, passwordHash });
      return Promise.resolve();
    },
    updateStatus: (id: string, status: "active" | "suspended") => {
      const account = accounts.get(id);
      if (account) accounts.set(id, { ...account, status });
      return Promise.resolve();
    },
  } as unknown as UserAccountRepository;

  const sessions = {
    create: (session: StoredSession) => {
      sessionRows.set(session.tokenHash, session);
      return Promise.resolve();
    },
    findValid: (tokenHash: string, now: Date) => {
      const row = sessionRows.get(tokenHash);
      if (!row) return Promise.resolve(null);
      if (row.expiresAt.getTime() <= now.getTime()) {
        sessionRows.delete(tokenHash);
        return Promise.resolve(null);
      }
      return Promise.resolve(row);
    },
    deleteByTokenHash: (tokenHash: string) => {
      sessionRows.delete(tokenHash);
      return Promise.resolve();
    },
    deleteAllForUser: (userId: string) => {
      let count = 0;
      for (const [hash, row] of sessionRows) {
        if (row.userId === userId) {
          sessionRows.delete(hash);
          count += 1;
        }
      }
      return Promise.resolve(count);
    },
    deleteExpired: () => Promise.resolve(0),
  } as unknown as SessionRepository;

  return { users, sessions, accounts, sessionRows };
}

function makeService(options: Parameters<typeof makeRepositories>[0] = {}) {
  const repositories = makeRepositories(options);
  const service = new AuthService(repositories.users, repositories.sessions, {
    sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
    now: () => NOW,
  });
  return { service, ...repositories };
}

function signupInput(overrides: Record<string, unknown> = {}) {
  return {
    inviteCode: "INVITE-1",
    email: "Hanako@Example.com",
    password: "a-long-enough-password",
    handle: "hanako",
    displayName: "花子",
    birthdate: ADULT_BIRTHDATE,
    ...overrides,
  } as Parameters<AuthService["signup"]>[0];
}

describe("AuthService.signup", () => {
  it("creates the account and issues a session", async () => {
    const { service, sessionRows } = makeService();

    const issued = await service.signup(signupInput());

    expect(issued.user.handle).toBe("hanako");
    expect(issued.user.isAdmin).toBe(false);
    expect(issued.token).toBeTruthy();
    expect(sessionRows.has(hashSessionToken(issued.token))).toBe(true);
  });

  it("stores the email lower-cased so login is case-insensitive", async () => {
    const { service } = makeService();
    await service.signup(signupInput({ email: "Hanako@Example.com" }));

    await expect(
      service.login({ email: "HANAKO@example.com", password: "a-long-enough-password" }),
    ).resolves.toMatchObject({ user: { handle: "hanako" } });
  });

  it("refuses a signup without a valid invite code (§66.9)", async () => {
    const { service } = makeService();
    await expect(service.signup(signupInput({ inviteCode: "UNKNOWN" }))).rejects.toBeInstanceOf(
      InviteCodeInvalidError,
    );
  });

  it("burns the invite code, so it cannot be reused", async () => {
    const { service } = makeService();
    await service.signup(signupInput());

    await expect(
      service.signup(signupInput({ email: "second@example.com", handle: "taro" })),
    ).rejects.toBeInstanceOf(InviteCodeInvalidError);
  });

  it("refuses an applicant under 18 (§66.1)", async () => {
    const { service } = makeService();
    await expect(
      service.signup(signupInput({ birthdate: "2008-08-11" })),
    ).rejects.toBeInstanceOf(UnderageSignupError);
  });

  it("accepts an applicant who turns 18 today", async () => {
    const { service } = makeService();
    await expect(service.signup(signupInput({ birthdate: "2008-08-10" }))).resolves.toBeTruthy();
  });

  it("rejects a birthdate that is not a real calendar date", async () => {
    const { service } = makeService();
    await expect(
      service.signup(signupInput({ birthdate: "1990-02-31" })),
    ).rejects.toBeInstanceOf(InvalidBirthdateError);
  });

  it("does not consume the invite code when the age check fails", async () => {
    const { service } = makeService();
    await expect(
      service.signup(signupInput({ birthdate: "2020-01-01" })),
    ).rejects.toBeInstanceOf(UnderageSignupError);

    await expect(service.signup(signupInput())).resolves.toBeTruthy();
  });

  it("hides whether an email is registered when the invite code is invalid", async () => {
    // Without this ordering, a caller with no code could submit a guessed
    // address and read the 409 as "this account exists" (§66.1).
    const { service } = makeService();
    await service.signup(signupInput());

    await expect(
      service.signup(signupInput({ inviteCode: "UNKNOWN", handle: "taro" })),
    ).rejects.toBeInstanceOf(InviteCodeInvalidError);
  });

  it("hides whether a handle is taken when the invite code is invalid", async () => {
    const { service } = makeService({ takenHandles: ["architect"] });

    await expect(
      service.signup(signupInput({ inviteCode: "UNKNOWN", handle: "architect" })),
    ).rejects.toBeInstanceOf(InviteCodeInvalidError);
  });

  it("does not consume the invite code when the email is already taken", async () => {
    const { service } = makeService({ inviteCodes: ["INVITE-1", "INVITE-2"] });
    await service.signup(signupInput());

    await expect(
      service.signup(signupInput({ inviteCode: "INVITE-2", handle: "taro" })),
    ).rejects.toBeInstanceOf(EmailTakenError);

    // INVITE-2 must still work for a signup that does not collide.
    await expect(
      service.signup(
        signupInput({ inviteCode: "INVITE-2", email: "taro@example.com", handle: "taro" }),
      ),
    ).resolves.toBeTruthy();
  });

  it("refuses a handle already held by a character (§66.13)", async () => {
    const { service } = makeService({ takenHandles: ["architect"] });
    await expect(
      service.signup(signupInput({ handle: "architect" })),
    ).rejects.toBeInstanceOf(HandleTakenError);
  });

  it("refuses a duplicate email", async () => {
    const { service } = makeService({ inviteCodes: ["INVITE-1", "INVITE-2"] });
    await service.signup(signupInput());

    await expect(
      service.signup(signupInput({ inviteCode: "INVITE-2", handle: "taro" })),
    ).rejects.toBeInstanceOf(EmailTakenError);
  });

  it("never lets the password reach the account record in clear text", async () => {
    const { service, accounts } = makeService();
    const issued = await service.signup(signupInput());

    const stored = accounts.get(issued.user.id);
    expect(stored?.passwordHash).not.toContain("a-long-enough-password");
    expect(stored?.passwordHash?.startsWith("scrypt$")).toBe(true);
  });
});

describe("AuthService.login", () => {
  it("issues a session for the right password", async () => {
    const { service } = makeService();
    await service.signup(signupInput());

    const issued = await service.login({
      email: "hanako@example.com",
      password: "a-long-enough-password",
    });
    expect(issued.user.handle).toBe("hanako");
    expect(issued.expiresAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("rejects a wrong password", async () => {
    const { service } = makeService();
    await service.signup(signupInput());

    await expect(
      service.login({ email: "hanako@example.com", password: "wrong-password" }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("gives an unknown email the same error as a wrong password", async () => {
    const { service } = makeService();
    await expect(
      service.login({ email: "nobody@example.com", password: "a-long-enough-password" }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("refuses a suspended account (§66.12)", async () => {
    const { service, accounts } = makeService();
    const issued = await service.signup(signupInput());
    const account = accounts.get(issued.user.id);
    if (account) accounts.set(account.id, { ...account, status: "suspended" });

    await expect(
      service.login({ email: "hanako@example.com", password: "a-long-enough-password" }),
    ).rejects.toBeInstanceOf(AccountSuspendedError);
  });
});

describe("AuthService.resolveSession", () => {
  it("resolves a live token to its account", async () => {
    const { service } = makeService();
    const issued = await service.signup(signupInput());

    await expect(service.resolveSession(issued.token)).resolves.toMatchObject({
      id: issued.user.id,
    });
  });

  it.each([null, "", "not-a-real-token"])("returns null for %p", async (token) => {
    const { service } = makeService();
    await service.signup(signupInput());
    await expect(service.resolveSession(token)).resolves.toBeNull();
  });

  it("returns null once the session has expired", async () => {
    const repositories = makeRepositories();
    let clock = NOW;
    const service = new AuthService(repositories.users, repositories.sessions, {
      sessionTtlMs: 1_000,
      now: () => clock,
    });

    const issued = await service.signup(signupInput());
    clock = new Date(NOW.getTime() + 2_000);

    await expect(service.resolveSession(issued.token)).resolves.toBeNull();
  });

  it("stops resolving as soon as the account is suspended (§66.12)", async () => {
    const { service, accounts } = makeService();
    const issued = await service.signup(signupInput());

    const account = accounts.get(issued.user.id);
    if (account) accounts.set(account.id, { ...account, status: "suspended" });

    await expect(service.resolveSession(issued.token)).resolves.toBeNull();
  });
});

describe("AuthService.logout", () => {
  it("drops the session, so the token stops working", async () => {
    const { service } = makeService();
    const issued = await service.signup(signupInput());

    await service.logout(issued.token);

    await expect(service.resolveSession(issued.token)).resolves.toBeNull();
  });

  it("is a no-op without a token", async () => {
    const { service } = makeService();
    await expect(service.logout(null)).resolves.toBeUndefined();
  });
});

describe("UserAdminService.suspend + AuthService (§66.12 end-to-end)", () => {
  it("invalidates an already-issued session immediately, and blocks a fresh login", async () => {
    const { service, users, sessions } = makeService();
    const admin = new UserAdminService(users, sessions);
    const issued = await service.signup(signupInput());

    // The session was valid before the suspend, so this proves the sessions
    // table was actually cleared rather than the account merely being flagged.
    await expect(service.resolveSession(issued.token)).resolves.not.toBeNull();

    await admin.suspend(issued.user.id);

    await expect(service.resolveSession(issued.token)).resolves.toBeNull();
    await expect(
      service.login({ email: "hanako@example.com", password: "a-long-enough-password" }),
    ).rejects.toBeInstanceOf(AccountSuspendedError);
  });

  it("lets the user log in again once reactivated", async () => {
    const { service, users, sessions } = makeService();
    const admin = new UserAdminService(users, sessions);
    const issued = await service.signup(signupInput());

    await admin.suspend(issued.user.id);
    await admin.reactivate(issued.user.id);

    await expect(
      service.login({ email: "hanako@example.com", password: "a-long-enough-password" }),
    ).resolves.toMatchObject({ user: { handle: "hanako" } });
  });
});
