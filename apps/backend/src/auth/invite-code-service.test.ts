import { describe, expect, it } from "vitest";
import type { NewInviteCode } from "./invite-code-repository.js";
import type { InviteCodeRepository } from "./invite-code-repository.js";
import type { InviteCode } from "./invite-code.js";
import { InviteCodeService } from "./invite-code-service.js";

const NOW = new Date(Date.UTC(2026, 7, 11));

function makeService() {
  const created: InviteCode[] = [];

  const inviteCodes = {
    create: (input: NewInviteCode) => {
      const inviteCode: InviteCode = {
        code: input.code,
        issuedById: input.issuedById,
        ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
        createdAt: NOW,
      };
      created.push(inviteCode);
      return Promise.resolve(inviteCode);
    },
    listAll: () => Promise.resolve([...created]),
  } as unknown as InviteCodeRepository;

  const service = new InviteCodeService(inviteCodes, () => NOW);
  return { service, created };
}

describe("InviteCodeService.issue", () => {
  it("issues a code with no expiry by default", async () => {
    const { service } = makeService();

    const inviteCode = await service.issue("admin-1");

    expect(inviteCode.issuedById).toBe("admin-1");
    expect(inviteCode.code).toBeTruthy();
    expect(inviteCode.expiresAt).toBeUndefined();
  });

  it("computes expiresAt from expiresInDays", async () => {
    const { service } = makeService();

    const inviteCode = await service.issue("admin-1", { expiresInDays: 7 });

    expect(inviteCode.expiresAt?.getTime()).toBe(NOW.getTime() + 7 * 24 * 60 * 60 * 1000);
  });

  it("issues a different code on each call", async () => {
    const { service, created } = makeService();

    await service.issue("admin-1");
    await service.issue("admin-1");

    expect(created[0]?.code).not.toBe(created[1]?.code);
  });
});

describe("InviteCodeService.list", () => {
  it("returns every issued code", async () => {
    const { service } = makeService();
    await service.issue("admin-1");
    await service.issue("admin-1");

    await expect(service.list()).resolves.toHaveLength(2);
  });
});
