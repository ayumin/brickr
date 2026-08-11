import { describe, expect, it } from "vitest";
import { HandleTakenError, normalizeHandle } from "./handle.js";

describe("normalizeHandle", () => {
  it.each([
    ["architect", "architect"],
    ["@architect", "architect"],
    ["Architect", "architect"],
    ["  @Architect  ", "architect"],
    ["@ARCHITECT", "architect"],
  ])("normalizes %p to %p", (input, expected) => {
    expect(normalizeHandle(input)).toBe(expected);
  });

  it("strips only the leading @, not one inside the handle", () => {
    expect(normalizeHandle("@a@b")).toBe("a@b");
  });
});

describe("HandleTakenError", () => {
  it("names the handle it could not take", () => {
    expect(new HandleTakenError("architect").message).toContain("@architect");
  });
});
