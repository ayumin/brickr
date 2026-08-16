import { describe, expect, it } from "vitest";
import { RESERVED_HANDLES, isReservedHandle } from "./handle.js";

// Mirrors apps/backend/src/characters/character-seeds.ts. Kept as a literal
// list rather than an import: packages/shared must never depend on backend
// code (CLAUDE.md §10), and this is exactly the collision check a reserved
// word must never accidentally introduce.
const SEED_CHARACTER_HANDLES = [
  "architect", "skeptic", "explorer", "kansai", "ceo", "engineer", "lawyer",
  "beginner", "optimist", "pessimist", "contrarian", "oldtimer", "influencer",
  "researcher",
];

describe("RESERVED_HANDLES", () => {
  it("has no duplicate entries", () => {
    expect(new Set(RESERVED_HANDLES).size).toBe(RESERVED_HANDLES.length);
  });

  it("does not collide with any seed character's handle", () => {
    for (const handle of SEED_CHARACTER_HANDLES) {
      expect(RESERVED_HANDLES).not.toContain(handle);
    }
  });

  it("does not reserve the pre-login user's own handle", () => {
    expect(RESERVED_HANDLES).not.toContain("you");
  });
});

describe("isReservedHandle", () => {
  it("matches a reserved word exactly", () => {
    expect(isReservedHandle("login")).toBe(true);
    expect(isReservedHandle("settings")).toBe(true);
  });

  it("is case-insensitive and trims surrounding whitespace", () => {
    expect(isReservedHandle("LOGIN")).toBe(true);
    expect(isReservedHandle("  settings  ")).toBe(true);
  });

  it("reserves the routes this MR adds above the /:handle catch-all", () => {
    expect(isReservedHandle("characters")).toBe(true);
    expect(isReservedHandle("simulations")).toBe(true);
    expect(isReservedHandle("posts")).toBe(true);
  });

  it("does not reserve 'admin': there is no /admin route (§6.1), and ADMIN_HANDLE defaults to exactly this word (CLAUDE.md §66.9)", () => {
    expect(isReservedHandle("admin")).toBe(false);
  });

  it("does not flag an ordinary handle", () => {
    expect(isReservedHandle("architect")).toBe(false);
    expect(isReservedHandle("you")).toBe(false);
  });
});
