import { randomUUID } from "node:crypto";
import type { UserStatus } from "@brickr/shared";
import { claimHandle } from "../handles/handle-claim.js";
import { isUniqueConstraintError, type Db } from "../persistence/prisma.js";
import { optionalField } from "../persistence/repository-mapping.js";
import { EmailTakenError, InviteCodeInvalidError } from "./auth-errors.js";
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
    ...optionalField("avatarUrl", row.avatarUrl),
    email: row.email ?? "",
    passwordHash: row.passwordHash,
    isAdmin: row.isAdmin,
    status: toStatus(row.status),
    ...optionalField("country", row.country),
    ...optionalField("region", row.region),
    interests: row.interests,
    ...optionalField("occupation", row.occupation),
    ...optionalField("xHandle", row.xHandle),
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
      if (inviteCode !== null) {
        // Checked before anything touches the email or the handle. Otherwise a
        // caller without a valid code could submit a guessed address and learn
        // from the 409 whether it is registered, and email is private (§66.1).
        const usable = await tx.inviteCode.findFirst({
          where: {
            code: inviteCode,
            usedById: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          select: { code: true },
        });
        if (!usable) throw new InviteCodeInvalidError();
      }

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

      // The shared primary key is what rejects a handle already held by a
      // character, which is the whole point of the table (§66.13).
      await claimHandle(tx, { handle: input.handle, ownerType: "user", ownerId: id });

      if (inviteCode !== null) {
        // The check above cannot enforce single use on its own: two concurrent
        // signups can both pass it. This compare-and-set is the authority, and
        // `usedById: null` in the filter means only one of them may win. It
        // needs the user row to exist first, because `usedById` is a foreign key.
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

  /** Flips `active` ↔ `suspended` (§66.12). Silently a no-op for an unknown id. */
  async updateStatus(id: string, status: UserStatus): Promise<void> {
    await this.db.userProfile.updateMany({ where: { id }, data: { status } });
  }

  /**
   * The admin user-management table (§66.15). `page` is 1-based; `search`
   * matches handle, display name or email, case-insensitively.
   */
  async listManagement(options: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<{ accounts: UserAccountWithSecret[]; totalCount: number }> {
    const where = options.search
      ? {
          OR: [
            { handle: { contains: options.search, mode: "insensitive" as const } },
            { displayName: { contains: options.search, mode: "insensitive" as const } },
            { email: { contains: options.search, mode: "insensitive" as const } },
          ],
        }
      : {};

    const [rows, totalCount] = await Promise.all([
      this.db.userProfile.findMany({
        where,
        select: SELECT,
        orderBy: { createdAt: "asc" },
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
      }),
      this.db.userProfile.count({ where }),
    ]);

    return { accounts: rows.map(toAccount), totalCount };
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Moved to the persistence layer once the handles module needed it too. Kept
// exported here so existing import sites do not have to change.
export { isUniqueConstraintError };
