import { describe, expect, it } from "vitest";
import { canManageCharacter } from "./character-ownership";

const CURRENT_USER_ID = "user-1";

describe("canManageCharacter", () => {
  it("allows the creator", () => {
    expect(canManageCharacter({ createdByUserId: CURRENT_USER_ID }, CURRENT_USER_ID, false)).toBe(
      true,
    );
  });

  it("allows an admin regardless of creator", () => {
    expect(canManageCharacter({ createdByUserId: "someone-else" }, CURRENT_USER_ID, true)).toBe(
      true,
    );
  });

  it("disallows a non-admin who is not the creator", () => {
    expect(
      canManageCharacter({ createdByUserId: "someone-else" }, CURRENT_USER_ID, false),
    ).toBe(false);
  });

  it("disallows a non-admin for a character with no visible creator (someone else's, or a System seed)", () => {
    expect(canManageCharacter({ createdByUserId: undefined }, CURRENT_USER_ID, false)).toBe(
      false,
    );
  });

  it("allows an admin for a character with no visible creator", () => {
    expect(canManageCharacter({ createdByUserId: undefined }, CURRENT_USER_ID, true)).toBe(true);
  });
});
