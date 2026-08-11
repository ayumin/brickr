import { describe, expect, it } from "vitest";
import { generateInviteCode, inviteCodeStatus, toInviteCodeDto } from "./invite-code.js";
import type { InviteCode } from "./invite-code.js";

const NOW = new Date(Date.UTC(2026, 7, 11));

const issued: InviteCode = {
  code: "abc123",
  issuedById: "admin-1",
  createdAt: NOW,
};

describe("generateInviteCode", () => {
  it("generates a different code on every call", () => {
    expect(generateInviteCode()).not.toBe(generateInviteCode());
  });
});

describe("inviteCodeStatus", () => {
  it("reports an unused code with no expiry as unused", () => {
    expect(inviteCodeStatus(issued, NOW)).toBe("unused");
  });

  it("reports a redeemed code as used, even past its expiry", () => {
    const redeemed: InviteCode = {
      ...issued,
      usedById: "user-2",
      expiresAt: new Date(NOW.getTime() - 1_000),
    };
    expect(inviteCodeStatus(redeemed, NOW)).toBe("used");
  });

  it("reports an unredeemed code past its expiry as expired", () => {
    const expired: InviteCode = { ...issued, expiresAt: new Date(NOW.getTime() - 1_000) };
    expect(inviteCodeStatus(expired, NOW)).toBe("expired");
  });

  it("reports an unredeemed code before its expiry as unused", () => {
    const future: InviteCode = { ...issued, expiresAt: new Date(NOW.getTime() + 1_000) };
    expect(inviteCodeStatus(future, NOW)).toBe("unused");
  });
});

describe("toInviteCodeDto", () => {
  it("omits unset optional fields rather than sending null", () => {
    const dto = toInviteCodeDto(issued, NOW);
    expect(dto).not.toHaveProperty("usedById");
    expect(dto).not.toHaveProperty("usedAt");
    expect(dto).not.toHaveProperty("expiresAt");
    expect(dto.status).toBe("unused");
  });

  it("serializes dates to ISO strings", () => {
    const redeemed: InviteCode = {
      ...issued,
      usedById: "user-2",
      usedAt: NOW,
      expiresAt: NOW,
    };
    const dto = toInviteCodeDto(redeemed, NOW);
    expect(dto.usedAt).toBe(NOW.toISOString());
    expect(dto.expiresAt).toBe(NOW.toISOString());
    expect(dto.createdAt).toBe(NOW.toISOString());
  });
});
