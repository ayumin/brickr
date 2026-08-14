import type { Db } from "../persistence/prisma.js";
import { optionalField } from "../persistence/repository-mapping.js";
import type { InviteCode } from "./invite-code.js";

type InviteCodeRow = {
  code: string;
  issuedById: string;
  usedById: string | null;
  usedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
};

function toInviteCode(row: InviteCodeRow): InviteCode {
  return {
    code: row.code,
    issuedById: row.issuedById,
    ...optionalField("usedById", row.usedById),
    ...optionalField("usedAt", row.usedAt),
    ...optionalField("expiresAt", row.expiresAt),
    createdAt: row.createdAt,
  };
}

const SELECT = {
  code: true,
  issuedById: true,
  usedById: true,
  usedAt: true,
  expiresAt: true,
  createdAt: true,
} as const;

export type NewInviteCode = {
  code: string;
  issuedById: string;
  expiresAt?: Date;
};

export class InviteCodeRepository {
  constructor(private readonly db: Db) {}

  async create(input: NewInviteCode): Promise<InviteCode> {
    const row = await this.db.inviteCode.create({
      data: {
        code: input.code,
        issuedById: input.issuedById,
        expiresAt: input.expiresAt ?? null,
      },
      select: SELECT,
    });
    return toInviteCode(row);
  }

  /** Admin-only listing (§66.9, §66.15); the codebase issues few enough that pagination isn't needed yet. */
  async listAll(): Promise<InviteCode[]> {
    const rows = await this.db.inviteCode.findMany({
      select: SELECT,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toInviteCode);
  }
}
