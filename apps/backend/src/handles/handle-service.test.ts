import { describe, expect, it } from "vitest";
import type { UserAccountRepository } from "../auth/user-account-repository.js";
import type { UserAccountWithSecret } from "../auth/user-account.js";
import type { CharacterRepository } from "../characters/character-repository.js";
import type { Character } from "../characters/character.js";
import { HandleService } from "./handle-service.js";
import type { HandleRepository } from "./handle-repository.js";
import { normalizeHandle, type HandleOwner } from "./handle.js";

const character: Character = {
  id: "character-1",
  handle: "architect",
  displayName: "アーキテクト",
  description: "設計の話をする",
  rolePrompt: "role",
  tonePrompt: "tone",
  interests: ["建築"],
  activityLevel: 0.5,
  responseProbability: 0.5,
  replyProbability: 0.6,
  quoteProbability: 0.2,
  influence: 0.5,
  modelProfileId: "model-1",
};

const user: UserAccountWithSecret = {
  id: "user-1",
  handle: "hanako",
  displayName: "花子",
  description: "自己紹介",
  email: "hanako@example.com",
  passwordHash: "scrypt$32768$8$1$c2FsdA==$aGFzaA==",
  isAdmin: true,
  status: "active",
  interests: [],
};

function makeService(owners: HandleOwner[]) {
  const handles = {
    findByHandle: (handle: string) =>
      Promise.resolve(owners.find((o) => o.handle === normalizeHandle(handle)) ?? null),
  } as unknown as HandleRepository;

  const characters = {
    findByIdIncludingDeleted: (id: string) =>
      Promise.resolve(id === character.id ? character : null),
  } as unknown as CharacterRepository;

  const users = {
    findById: (id: string) => Promise.resolve(id === user.id ? user : null),
  } as unknown as UserAccountRepository;

  return new HandleService(handles, characters, users);
}

const characterOwner: HandleOwner = {
  handle: "architect",
  ownerType: "character",
  ownerId: "character-1",
};

const userOwner: HandleOwner = {
  handle: "hanako",
  ownerType: "user",
  ownerId: "user-1",
};

describe("HandleService.resolve", () => {
  it("resolves a character handle to its public DTO", async () => {
    const service = makeService([characterOwner]);

    await expect(service.resolve("architect")).resolves.toEqual({
      ownerType: "character",
      character: {
        id: "character-1",
        handle: "architect",
        displayName: "アーキテクト",
        description: "設計の話をする",
      },
    });
  });

  it("never exposes character prompts through a handle lookup", async () => {
    const service = makeService([characterOwner]);

    const resolved = await service.resolve("architect");

    expect(resolved).not.toHaveProperty("character.rolePrompt");
    expect(resolved).not.toHaveProperty("character.tonePrompt");
    expect(resolved).not.toHaveProperty("character.modelProfileId");
  });

  it("resolves a user handle", async () => {
    const service = makeService([userOwner]);

    await expect(service.resolve("hanako")).resolves.toEqual({
      ownerType: "user",
      user: {
        id: "user-1",
        handle: "hanako",
        displayName: "花子",
        description: "自己紹介",
      },
    });
  });

  it("never exposes the email, admin flag or status of a user (§66.1)", async () => {
    const service = makeService([userOwner]);

    const resolved = await service.resolve("hanako");

    expect(resolved).not.toHaveProperty("user.email");
    expect(resolved).not.toHaveProperty("user.passwordHash");
    expect(resolved).not.toHaveProperty("user.isAdmin");
    expect(resolved).not.toHaveProperty("user.status");
  });

  it.each(["@architect", "Architect", "  @ARCHITECT "])(
    "accepts %p for the same handle",
    async (input) => {
      const service = makeService([characterOwner]);
      await expect(service.resolve(input)).resolves.toMatchObject({
        ownerType: "character",
      });
    },
  );

  it("returns null for an unknown handle", async () => {
    const service = makeService([characterOwner]);
    await expect(service.resolve("nobody")).resolves.toBeNull();
  });

  it("returns null when the claim points at a row that no longer exists", async () => {
    const service = makeService([
      { handle: "ghost", ownerType: "character", ownerId: "character-missing" },
    ]);

    await expect(service.resolve("ghost")).resolves.toBeNull();
  });
});
