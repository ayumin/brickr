import { randomUUID } from "node:crypto";
import type { UserStatus } from "@brickr/shared";
import type { Db } from "../persistence/prisma.js";
import { EmailTakenError, HandleTakenError, InviteCodeInvalidError } from "./auth-errors.js";
import type { NewUserAccount, UserAccountWithSecret } from "./user-account.js";

type UserRow = {
  id: string;
  handle: string | null;
  displayName: string;
  description: string;
  avatarUrl: string | null;
  email: string | null;
  passwordHash: string | null;
  isAdmin: boolean;
  status: string;
  country: string | null;
  region: string | null;
  interests: string[];
  occupation: string | null;
  xHandle: string | null;
};

function toAccount(row: UserRow): UserAccountWithSecret {
  return {
    id: row.id,
    // Only the pre-login singleton can lack a handle; it is backfilled by the
    // seed, and falling back to the id keeps that row renderable meanwhile.
    handle: row.handle ?? row.id,
    displayName: row.displayName,
    description: row.description,
    ...(row.avatarUrl ? { avatarUrl: row.avatarUrl } : {}),
    email: row.email ?? "",
    passwordHash: row.passwordHash,
    isAdmin: row.isAdmin,
    status: toStatus(row.status),
    ...(row.country ? { country: row.country } : {}),
    ...(row.region ? { region: row.region } : {}),
    interests: row.interests,
    ...(row.occupation ? { occupation: row.occupation } : {}),
    ...(row.xHandle ? { xHandle: row.xHandle } : {}),
  };
}

/** Unknown values are treated as suspended: fail closed, never open. */
function toStatus(value: string): UserStatus {
  return value === "active" ? "active" : "suspended";
}

const SELECT = {
  id: true,
  handle: true,
  displayName: true,
  description: true,
  avatarUrl: true,
  email: true,
  passwordHash: true,
  isAdmin: true,
  status: true,
  country: true,
  region: true,
  interests: true,
  occupation: true,
  xHandle: true,
} as const;

export class UserAccountRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<UserAccountWithSecret | null> {
    const row = await this.db.userProfile.findUnique({ where: { id }, select: SELECT });
    return row ? toAccount(row) : null;
  }

  /** Emails are stored and compared lower-cased, so login is case-insensitive. */
  async findByEmail(email: string): Promise<UserAccountWithSecret | null> {
    const row = await this.db.userProfile.findUnique({
      where: { email: normalizeEmail(email) },
      select: SELECT,
    });
    return row ? toAccount(row) : null;
  }

  /**
   * Creates an account, claims its handle and burns the invite code in one
   * transaction (§66.9, §66.13). Any failure rolls the whole thing back, so a
   * rejected signup can never consume a code or leave a dangling handle.
   *
   * `inviteCode` is null only for the env-driven admin bootstrap (§66.9).
   */
  async createInvited(
    input: NewUserAccount,
    inviteCode: string | null,
    now: Date = new Date(),
  ): Promise<UserAccountWithSecret> {
    const id = randomUUID();

    return this.db.$transaction(async (tx) => {
      let row: UserRow;
      try {
        row = await tx.userProfile.create({
          data: {
            id,
            handle: input.handle,
            displayName: input.displayName,
            description: input.description,
            email: normalizeEmail(input.email),
            passwordHash: input.passwordHash,
            birthdate: input.birthdate ?? null,
            isAdmin: input.isAdmin,
            status: "active",
            country: input.country ?? null,
            region: input.region ?? null,
            interests: input.interests,
            occupation: input.occupation ?? null,
            xHandle: input.xHandle ?? null,
          },
          select: SELECT,
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) throw new EmailTakenError();
        throw error;
      }

      try {
        await tx.handleOwner.create({
          data: { handle: input.handle, ownerType: "user", ownerId: id },
        });
      } catch (error) {
        // The shared primary key is what rejects a handle already held by a
        // character, which is the whole point of the table (§66.13).
        if (isUniqueConstraintError(error)) throw new HandleTakenError(input.handle);
        throw error;
      }

      if (inviteCode !== null) {
        // Compare-and-set: `usedById: null` in the filter means two concurrent
        // signups with one code cannot both succeed.
        const claimed = await tx.inviteCode.updateMany({
          where: {
            code: inviteCode,
            usedById: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          data: { usedById: id, usedAt: now },
        });
        if (claimed.count === 0) throw new InviteCodeInvalidError();
      }

      return toAccount(row);
    });
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.db.userProfile.update({ where: { id }, data: { passwordHash } });
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Duck-typed so the repository does not depend on Prisma's error classes. */
export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
