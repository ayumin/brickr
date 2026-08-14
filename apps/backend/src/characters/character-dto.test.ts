import { describe, expect, it } from "vitest";
import { toCharacterConfigDto, toCharacterManagementDto, type CharacterActor } from "./character-dto.js";
import type { Character } from "./character.js";

const OWNER: CharacterActor = { id: "owner-1", isAdmin: false };
const OTHER_USER: CharacterActor = { id: "other-1", isAdmin: false };
const ADMIN: CharacterActor = { id: "admin-1", isAdmin: true };

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: "character-1",
    handle: "architect",
    displayName: "Architect",
    description: "desc",
    rolePrompt: "role",
    tonePrompt: "tone",
    interests: [],
    activityLevel: 0.5,
    responseProbability: 0.5,
    replyProbability: 0.5,
    quoteProbability: 0.5,
    influence: 0.5,
    modelProfileId: "test-profile",
    createdByUserId: OWNER.id,
    ...overrides,
  };
}

describe("toCharacterConfigDto owner visibility (CLAUDE.md §66.5)", () => {
  it("includes createdByUserId for the creator", () => {
    const dto = toCharacterConfigDto(makeCharacter(), OWNER);
    expect(dto.createdByUserId).toBe(OWNER.id);
  });

  it("includes createdByUserId for an admin", () => {
    const dto = toCharacterConfigDto(makeCharacter(), ADMIN);
    expect(dto.createdByUserId).toBe(OWNER.id);
  });

  it("omits createdByUserId for anyone else, signed in or not", () => {
    const character = makeCharacter();
    expect(toCharacterConfigDto(character, OTHER_USER)).not.toHaveProperty("createdByUserId");
    expect(toCharacterConfigDto(character, null)).not.toHaveProperty("createdByUserId");
  });

  it("omits createdByUserId for a System-owned (seed) character even for the viewer's own id", () => {
    const seedCharacter = makeCharacter({ createdByUserId: undefined });
    expect(toCharacterConfigDto(seedCharacter, OWNER)).not.toHaveProperty("createdByUserId");
  });
});

describe("toCharacterManagementDto owner visibility (CLAUDE.md §66.5)", () => {
  it("includes createdByUserId only when the viewer is the creator", () => {
    const owned = toCharacterManagementDto(makeCharacter(), 0, OWNER);
    const other = toCharacterManagementDto(makeCharacter(), 0, OTHER_USER);

    expect(owned.createdByUserId).toBe(OWNER.id);
    expect(other).not.toHaveProperty("createdByUserId");
  });

  it("includes createdByUserId for an admin", () => {
    const dto = toCharacterManagementDto(makeCharacter(), 0, ADMIN);
    expect(dto.createdByUserId).toBe(OWNER.id);
  });

  it("omits createdByUserId when signed out", () => {
    const dto = toCharacterManagementDto(makeCharacter(), 0, null);
    expect(dto).not.toHaveProperty("createdByUserId");
  });

  it("computes isDeleted from deletedAt and omits persona prompts", () => {
    const active = toCharacterManagementDto(makeCharacter(), 3, OWNER);
    const deleted = toCharacterManagementDto(
      makeCharacter({ deletedAt: new Date("2026-01-01T00:00:00Z") }),
      3,
      OWNER,
    );

    expect(active.isDeleted).toBe(false);
    expect(active.postCount).toBe(3);
    expect(deleted.isDeleted).toBe(true);
    expect(active).not.toHaveProperty("rolePrompt");
    expect(active).not.toHaveProperty("tonePrompt");
  });
});
