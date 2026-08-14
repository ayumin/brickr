import { describe, expect, it } from "vitest";
import { decideSessionRestore } from "./session-restore";

describe("decideSessionRestore", () => {
  it("never checks for a signed-out visitor, even with a stored room id", () => {
    expect(decideSessionRestore(false, "/", "room-1")).toEqual({ action: "none" });
  });

  it("never checks off the home path, signed in or not", () => {
    expect(decideSessionRestore(true, "/rooms", "room-1")).toEqual({ action: "none" });
    expect(decideSessionRestore(true, "/cast", "room-1")).toEqual({ action: "none" });
  });

  it("does nothing when there is no stored room to restore", () => {
    expect(decideSessionRestore(true, "/", null)).toEqual({ action: "none" });
  });

  it("checks when signed in, on the home path, with a stored room id", () => {
    expect(decideSessionRestore(true, "/", "room-1")).toEqual({ action: "check-room" });
  });
});
