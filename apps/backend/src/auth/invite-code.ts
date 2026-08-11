import { randomBytes } from "node:crypto";
import type { InviteCodeDto, InviteCodeStatus } from "@brickr/shared";

/** Backend domain model for a single-use signup invitation (CLAUDE.md §66.9). */
export type InviteCode = {
  code: string;
  issuedById: string;
  usedById?: string;
  usedAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
};

/**
 * Unguessable enough to hand out as a link or a short message, and stored in
 * clear text (§66.9 leaves this deliberately unhashed — unlike a password, an
 * invite code confers no access once it names an already-created account).
 */
export function generateInviteCode(): string {
  return randomBytes(9).toString("base64url");
}

export function inviteCodeStatus(
  inviteCode: Pick<InviteCode, "usedById" | "expiresAt">,
  now: Date = new Date(),
): InviteCodeStatus {
  if (inviteCode.usedById) return "used";
  if (inviteCode.expiresAt && inviteCode.expiresAt.getTime() <= now.getTime()) return "expired";
  return "unused";
}

export function toInviteCodeDto(inviteCode: InviteCode, now: Date = new Date()): InviteCodeDto {
  return {
    code: inviteCode.code,
    issuedById: inviteCode.issuedById,
    ...(inviteCode.usedById ? { usedById: inviteCode.usedById } : {}),
    ...(inviteCode.usedAt ? { usedAt: inviteCode.usedAt.toISOString() } : {}),
    ...(inviteCode.expiresAt ? { expiresAt: inviteCode.expiresAt.toISOString() } : {}),
    createdAt: inviteCode.createdAt.toISOString(),
    status: inviteCodeStatus(inviteCode, now),
  };
}
