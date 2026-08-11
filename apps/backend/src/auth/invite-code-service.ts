import type { CreateInviteCodeRequest } from "@brickr/shared";
import type { InviteCodeRepository } from "./invite-code-repository.js";
import { generateInviteCode, type InviteCode } from "./invite-code.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Issuing and listing invite codes (CLAUDE.md §66.9, §66.15). Redeeming one happens in AuthService.signup. */
export class InviteCodeService {
  constructor(
    private readonly inviteCodes: InviteCodeRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issue(issuedById: string, input: CreateInviteCodeRequest = {}): Promise<InviteCode> {
    return this.inviteCodes.create({
      code: generateInviteCode(),
      issuedById,
      ...(input.expiresInDays
        ? { expiresAt: new Date(this.now().getTime() + input.expiresInDays * MS_PER_DAY) }
        : {}),
    });
  }

  async list(): Promise<InviteCode[]> {
    return this.inviteCodes.listAll();
  }
}
