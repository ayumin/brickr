import type { LoginRequest, SignupRequest } from "@brickr/shared";
import {
  AccountSuspendedError,
  InvalidBirthdateError,
  InvalidCredentialsError,
  UnderageSignupError,
} from "./auth-errors.js";
import { isOldEnough, parseBirthdate } from "./birthdate.js";
import { hashPassword, verifyPassword } from "./password.js";
import { createSessionToken, hashSessionToken } from "./session-cookie.js";
import type { SessionRepository } from "./session-repository.js";
import type { UserAccountRepository } from "./user-account-repository.js";
import { isSuspended, type UserAccount } from "./user-account.js";

/** The raw token is handed to the caller once, to be put in the cookie. */
export type IssuedSession = {
  token: string;
  expiresAt: Date;
  user: UserAccount;
};

export type AuthServiceOptions = {
  sessionTtlMs: number;
  /** Injected for tests; production uses the wall clock. */
  now?: () => Date;
};

/**
 * Email + password authentication with invite-only signup (CLAUDE.md §66.8-§66.11).
 *
 * No email confirmation and no self-service reset by design (§66.10): an admin
 * issues a temporary password instead.
 */
export class AuthService {
  private readonly now: () => Date;

  constructor(
    private readonly users: UserAccountRepository,
    private readonly sessions: SessionRepository,
    private readonly options: AuthServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async signup(input: SignupRequest): Promise<IssuedSession> {
    const birthdate = parseBirthdate(input.birthdate);
    if (!birthdate) throw new InvalidBirthdateError();
    if (!isOldEnough(birthdate, this.now())) throw new UnderageSignupError();

    const account = await this.users.createInvited(
      {
        handle: input.handle,
        displayName: input.displayName,
        description: input.description ?? "",
        email: input.email,
        passwordHash: await hashPassword(input.password),
        birthdate,
        isAdmin: false,
        ...(input.country ? { country: input.country } : {}),
        ...(input.region ? { region: input.region } : {}),
        interests: input.interests ?? [],
        ...(input.occupation ? { occupation: input.occupation } : {}),
        ...(input.xHandle ? { xHandle: input.xHandle } : {}),
      },
      input.inviteCode,
      this.now(),
    );

    return this.issueSession(account);
  }

  async login(input: LoginRequest): Promise<IssuedSession> {
    const account = await this.users.findByEmail(input.email);

    if (!account) {
      // Hash anyway so an unknown email costs the same time as a wrong password.
      await verifyPassword(input.password, DUMMY_HASH);
      throw new InvalidCredentialsError();
    }
    if (!(await verifyPassword(input.password, account.passwordHash))) {
      throw new InvalidCredentialsError();
    }
    // Checked after the password so the response cannot be used to probe which
    // addresses belong to suspended accounts.
    if (isSuspended(account)) throw new AccountSuspendedError();

    return this.issueSession(account);
  }

  async logout(token: string | null): Promise<void> {
    if (!token) return;
    await this.sessions.deleteByTokenHash(hashSessionToken(token));
  }

  /**
   * Resolves a cookie token to its account, or null when the session is
   * unknown, expired, or the account was suspended in the meantime (§66.12).
   */
  async resolveSession(token: string | null): Promise<UserAccount | null> {
    if (!token) return null;

    const session = await this.sessions.findValid(hashSessionToken(token), this.now());
    if (!session) return null;

    const account = await this.users.findById(session.userId);
    if (!account || isSuspended(account)) return null;

    return account;
  }

  private async issueSession(user: UserAccount): Promise<IssuedSession> {
    const token = createSessionToken();
    const expiresAt = new Date(this.now().getTime() + this.options.sessionTtlMs);

    await this.sessions.create({
      tokenHash: hashSessionToken(token),
      userId: user.id,
      expiresAt,
    });

    return { token, expiresAt, user };
  }
}

/**
 * A real hash of an unguessable value. Verifying against it burns the same CPU
 * as a genuine check, which is what keeps the timing side channel closed.
 */
const DUMMY_HASH =
  "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
