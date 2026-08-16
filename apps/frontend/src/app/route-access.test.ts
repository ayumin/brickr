import { describe, expect, it } from "vitest";
import {
  checkAdminSettingsAccess,
  checkRoomAccess,
  checkSignedInOnlyAccess,
} from "./route-access";

const OWNER = { id: "owner-1", isAdmin: false };
const OTHER_USER = { id: "other-1", isAdmin: false };
const ADMIN = { id: "admin-1", isAdmin: true };

describe("checkRoomAccess", () => {
  it("denies a signed-out visitor regardless of room state", () => {
    expect(checkRoomAccess({ status: "active", createdByUserId: OWNER.id }, null)).toEqual({
      allowed: false,
      redirectTo: "/",
    });
  });

  it("denies when the room could not be found (404/403 from the fetch)", () => {
    expect(checkRoomAccess(null, OWNER)).toEqual({ allowed: false, redirectTo: "/" });
  });

  it("allows any signed-in user into an active room", () => {
    for (const user of [OWNER, OTHER_USER, ADMIN]) {
      expect(checkRoomAccess({ status: "active", createdByUserId: OWNER.id }, user)).toEqual({
        allowed: true,
      });
    }
  });

  it("allows only the creator or an admin into a stopped room", () => {
    const stopped = { status: "archived" as const, createdByUserId: OWNER.id };
    expect(checkRoomAccess(stopped, OWNER)).toEqual({ allowed: true });
    expect(checkRoomAccess(stopped, ADMIN)).toEqual({ allowed: true });
    expect(checkRoomAccess(stopped, OTHER_USER)).toEqual({ allowed: false, redirectTo: "/" });
  });

  it("denies everyone but an admin for a stopped, ownerless room", () => {
    const stopped = { status: "archived" as const, createdByUserId: undefined };
    expect(checkRoomAccess(stopped, OTHER_USER)).toEqual({ allowed: false, redirectTo: "/" });
    expect(checkRoomAccess(stopped, ADMIN)).toEqual({ allowed: true });
  });
});

describe("checkAdminSettingsAccess", () => {
  it.each(["profile", "appearance", "usage"])(
    "allows any signed-in user into the %s section",
    (section) => {
      expect(checkAdminSettingsAccess(section, OWNER)).toEqual({ allowed: true });
    },
  );

  it.each(["runtime", "users", "invites"])(
    "denies a non-admin the %s section",
    (section) => {
      expect(checkAdminSettingsAccess(section, OWNER)).toEqual({ allowed: false, redirectTo: "/" });
    },
  );

  it.each(["runtime", "users", "invites"])("allows an admin into the %s section", (section) => {
    expect(checkAdminSettingsAccess(section, ADMIN)).toEqual({ allowed: true });
  });

  it("denies a signed-out visitor an admin section", () => {
    expect(checkAdminSettingsAccess("users", null)).toEqual({ allowed: false, redirectTo: "/" });
  });
});

describe("checkSignedInOnlyAccess", () => {
  it("denies null or undefined", () => {
    expect(checkSignedInOnlyAccess(null)).toEqual({ allowed: false, redirectTo: "/" });
    expect(checkSignedInOnlyAccess(undefined)).toEqual({ allowed: false, redirectTo: "/" });
  });

  it("allows any other value", () => {
    expect(checkSignedInOnlyAccess(OWNER)).toEqual({ allowed: true });
  });
});
