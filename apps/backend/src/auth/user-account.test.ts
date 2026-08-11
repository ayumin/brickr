import { describe, expect, it } from "vitest";
import { isSuspended, toAuthUserDto } from "./user-account.js";
import type { UserAccountWithSecret } from "./user-account.js";

const account: UserAccountWithSecret = {
  id: "user-1",
  handle: "hanako",
  displayName: "花子",
  description: "自己紹介",
  email: "hanako@example.com",
  passwordHash: "scrypt$32768$8$1$c2FsdA==$aGFzaA==",
  isAdmin: false,
  status: "active",
  interests: ["建築"],
  country: "JP",
};

describe("toAuthUserDto", () => {
  it("never exposes the email or the password hash (§66.1)", () => {
    const dto = toAuthUserDto(account);
    expect(dto).not.toHaveProperty("email");
    expect(dto).not.toHaveProperty("passwordHash");
    expect(dto).not.toHaveProperty("birthdate");
  });

  it("keeps the public profile fields", () => {
    expect(toAuthUserDto(account)).toEqual({
      id: "user-1",
      handle: "hanako",
      displayName: "花子",
      description: "自己紹介",
      isAdmin: false,
      status: "active",
      interests: ["建築"],
      country: "JP",
    });
  });

  it("omits optional fields that are unset rather than sending null", () => {
    const dto = toAuthUserDto({ ...account, country: undefined, interests: [] });
    expect(dto).not.toHaveProperty("country");
    expect(dto.interests).toEqual([]);
  });
});

describe("isSuspended", () => {
  it.each([
    ["active" as const, false],
    ["suspended" as const, true],
  ])("reports %s as %p", (status, expected) => {
    expect(isSuspended({ status })).toBe(expected);
  });
});
