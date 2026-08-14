import type { SaveCharacterRequest } from "@brickr/shared";
import { describe, expect, it } from "vitest";
import type { ModelProfileRepository } from "../model-profiles/model-profile-repository.js";
import type { ModelProfile } from "../model-profiles/model-profile.js";
import type { CharacterRepository } from "./character-repository.js";
import type { CharacterActor } from "./character-dto.js";
import {
  CharacterGenerationError,
  type CharacterPersonaGenerator,
  type GeneratedCharacterPersona,
} from "./character-generator.js";
import {
  CharacterForbiddenError,
  CharacterHandleConflictError,
  CharacterNotFoundError,
  CharacterService,
  ModelProfileNotFoundError,
} from "./character-service.js";
import type { Character, SaveCharacter } from "./character.js";

const PROFILE: ModelProfile = {
  id: "anthropic-default",
  providerId: "anthropic",
  model: "test-model",
};

const REQUEST: SaveCharacterRequest = {
  handle: "new_character",
  displayName: "新しいキャラクター",
  description: "新規作成された人格",
  rolePrompt: "現実的な観点から考える。",
  tonePrompt: "短い丁寧語で話す。",
  interests: ["設計", "運用"],
  activityLevel: 0.6,
  responseProbability: 0.7,
  replyProbability: 0.8,
  quoteProbability: 0.2,
  influence: 0.4,
  modelProfileId: PROFILE.id,
};

/** The default actor for tests that are not themselves about ownership. */
const OWNER: CharacterActor = { id: "owner-1", isAdmin: false };
const OTHER_USER: CharacterActor = { id: "other-1", isAdmin: false };
const ADMIN: CharacterActor = { id: "admin-1", isAdmin: true };

/**
 * `createdByUserId` defaults to `OWNER.id`; pass `null` explicitly for a
 * System-owned (seed) character. A default parameter would not do — JS
 * substitutes the default for an explicit `undefined` too, silently hiding
 * the "no owner" case this function exists to express.
 */
function makeCharacter(
  id: string,
  input: SaveCharacterRequest = REQUEST,
  createdByUserId: string | null = OWNER.id,
): Character {
  return { id, ...input, ...(createdByUserId ? { createdByUserId } : {}) };
}

function makeService(
  initial: Character[] = [],
  profiles: ModelProfile[] = [PROFILE],
  generate?: (count: number) => Promise<GeneratedCharacterPersona[]>,
  postCounts: Map<string, number> = new Map(),
) {
  const characters = [...initial];

  const characterRepository = {
    findAll: (): Promise<Character[]> =>
      Promise.resolve(characters.filter((character) => !character.deletedAt)),
    findAllIncludingDeleted: (): Promise<Character[]> => Promise.resolve([...characters]),
    findAllByCreatedByUserId: (userId: string): Promise<Character[]> =>
      Promise.resolve(
        characters.filter(
          (character) => character.createdByUserId === userId && !character.deletedAt,
        ),
      ),
    findAllIncludingDeletedByCreatedByUserId: (userId: string): Promise<Character[]> =>
      Promise.resolve(characters.filter((character) => character.createdByUserId === userId)),
    findById: (id: string): Promise<Character | null> =>
      Promise.resolve(
        characters.find((character) => character.id === id && !character.deletedAt) ?? null,
      ),
    findByIdIncludingDeleted: (id: string): Promise<Character | null> =>
      Promise.resolve(characters.find((character) => character.id === id) ?? null),
    findByHandle: (handle: string): Promise<Character | null> =>
      Promise.resolve(characters.find((character) => character.handle === handle) ?? null),
    findByIds: (ids: string[]): Promise<Character[]> =>
      Promise.resolve(
        characters.filter((character) => ids.includes(character.id) && !character.deletedAt),
      ),
    findByIdsIncludingDeleted: (ids: string[]): Promise<Character[]> =>
      Promise.resolve(characters.filter((character) => ids.includes(character.id))),
    countPostsByCharacterIds: (ids: string[]): Promise<Map<string, number>> =>
      Promise.resolve(
        new Map(ids.map((id) => [id, postCounts.get(id) ?? 0])),
      ),
    create: (
      id: string,
      input: SaveCharacter,
      createdByUserId: string | null,
    ): Promise<Character> => {
      const character = { id, ...input, ...(createdByUserId ? { createdByUserId } : {}) };
      characters.push(character);
      return Promise.resolve(character);
    },
    createMany: (
      entries: Array<{ id: string; input: SaveCharacter; createdByUserId: string | null }>,
    ): Promise<Character[]> => {
      const created = entries.map(({ id, input, createdByUserId }) => ({
        id,
        ...input,
        ...(createdByUserId ? { createdByUserId } : {}),
      }));
      characters.push(...created);
      return Promise.resolve(created);
    },
    update: (id: string, input: SaveCharacter): Promise<Character> => {
      const index = characters.findIndex((character) => character.id === id);
      // Mirrors the real repository: an update never touches createdByUserId.
      const character = { id, ...input, createdByUserId: characters[index]?.createdByUserId };
      characters[index] = character;
      return Promise.resolve(character);
    },
    delete: (id: string): Promise<void> => {
      const index = characters.findIndex((character) => character.id === id);
      if (index >= 0) characters.splice(index, 1);
      return Promise.resolve();
    },
    deleteMany: (ids: string[]): Promise<void> => {
      for (let index = characters.length - 1; index >= 0; index -= 1) {
        if (ids.includes(characters[index]!.id)) characters.splice(index, 1);
      }
      return Promise.resolve();
    },
    restore: (id: string): Promise<void> => {
      const character = characters.find((candidate) => candidate.id === id);
      if (character) delete character.deletedAt;
      return Promise.resolve();
    },
  } as unknown as CharacterRepository;

  const modelProfileRepository = {
    findById: (id: string): Promise<ModelProfile | null> =>
      Promise.resolve(profiles.find((profile) => profile.id === id) ?? null),
    findAll: (): Promise<ModelProfile[]> => Promise.resolve([...profiles]),
  } as unknown as ModelProfileRepository;

  const personaGenerator: CharacterPersonaGenerator = {
    generate: (count) =>
      generate?.(count) ??
      Promise.resolve(
        Array.from({ length: count }, (_, index) => ({
          displayName: `LLM Character ${String(index + 1)}`,
          description: `LLM profile ${String(index + 1)}`,
          rolePrompt: `LLM role ${String(index + 1)}`,
          tonePrompt: `LLM tone ${String(index + 1)}`,
          interests: ["test"],
        })),
      ),
  };

  // Only the administrator's management list ever asks for creators (§20.3).
  const creators = {
    findByIds: (ids: string[]) =>
      Promise.resolve(
        ids.map((id) => ({ id, handle: `handle_${id}`, displayName: `User ${id}` })),
      ),
  };

  return {
    service: new CharacterService(
      characterRepository,
      modelProfileRepository,
      personaGenerator,
      creators,
      () => 0.37,
    ),
    characters,
  };
}

describe("CharacterService", () => {
  it("creates a character with editable persona, behaviour and model profile settings", async () => {
    const { service, characters } = makeService();

    const created = await service.create(REQUEST, OWNER);

    expect(created.id).toBeTruthy();
    expect(created).toMatchObject(REQUEST);
    expect(created.createdByUserId).toBe(OWNER.id);
    expect(characters).toHaveLength(1);
    expect(characters[0]?.createdByUserId).toBe(OWNER.id);
  });

  it("bulk creates LLM personas with unique handles and random behaviour", async () => {
    const { service, characters } = makeService();

    const created = await service.createMany(3, OWNER.id);

    expect(created).toHaveLength(3);
    expect(characters).toHaveLength(3);
    expect(new Set(created.map((character) => character.id)).size).toBe(3);
    expect(new Set(created.map((character) => character.handle)).size).toBe(3);
    expect(new Set(created.map((character) => character.avatarUrl)).size).toBe(3);
    expect(created.every((character) => character.avatarUrl?.startsWith("data:image/jpeg;base64,"))).toBe(true);
    expect(created[0]).not.toHaveProperty("modelProfileId");
    expect(characters.every((character) => character.createdByUserId === OWNER.id)).toBe(true);
    expect(characters[0]).toMatchObject({
      displayName: "LLM Character 1",
      description: "LLM profile 1",
      rolePrompt: "LLM role 1",
      modelProfileId: PROFILE.id,
      activityLevel: 0.37,
      responseProbability: 0.37,
      replyProbability: 0.37,
      quoteProbability: 0.37,
      influence: 0.37,
    });
  });

  it("does not persist any character when LLM persona generation fails", async () => {
    const { service, characters } = makeService([], [PROFILE], () =>
      Promise.reject(new Error("invalid LLM output")),
    );

    await expect(service.createMany(3, OWNER.id)).rejects.toBeInstanceOf(
      CharacterGenerationError,
    );
    expect(characters).toEqual([]);
  });

  it("updates an existing character without changing its id", async () => {
    const existing = makeCharacter("character-1");
    const { service } = makeService([existing]);

    const updated = await service.update(
      existing.id,
      { ...REQUEST, displayName: "変更後", rolePrompt: "変更後の考え方。" },
      OWNER,
    );

    expect(updated.id).toBe(existing.id);
    expect(updated.displayName).toBe("変更後");
    expect(updated.rolePrompt).toBe("変更後の考え方。");
  });

  it("keeps persona settings out of the lightweight character DTO", async () => {
    const existing = makeCharacter("character-1");
    const { service } = makeService([existing]);

    const publicDto = await service.findDto(existing.id, OWNER);
    const configDto = await service.findConfigDto(existing.id, OWNER);

    expect(publicDto).not.toHaveProperty("rolePrompt");
    expect(configDto).toHaveProperty("rolePrompt", REQUEST.rolePrompt);
  });

  it("lists model and behaviour settings without exposing persona prompts", async () => {
    const existing = makeCharacter("character-1");
    const { service } = makeService(
      [existing],
      [PROFILE],
      undefined,
      new Map([[existing.id, 7]]),
    );

    const [managementDto] = await service.listManagementDtos(OWNER);

    expect(managementDto).toMatchObject({
      id: existing.id,
      isDeleted: false,
      postCount: 7,
      modelProfileId: REQUEST.modelProfileId,
      activityLevel: REQUEST.activityLevel,
      responseProbability: REQUEST.responseProbability,
      replyProbability: REQUEST.replyProbability,
      quoteProbability: REQUEST.quoteProbability,
      influence: REQUEST.influence,
    });
    expect(managementDto).not.toHaveProperty("rolePrompt");
    expect(managementDto).not.toHaveProperty("tonePrompt");
  });

  it("keeps stopped characters out of the public list but includes them in management", async () => {
    const active = makeCharacter("character-active");
    const stopped = {
      ...makeCharacter("character-stopped", { ...REQUEST, handle: "stopped" }),
      deletedAt: new Date("2026-01-01T00:00:00Z"),
    };
    const { service } = makeService([active, stopped]);

    await expect(service.listDtos(OWNER)).resolves.toHaveLength(1);
    await expect(service.listManagementDtos(OWNER)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: active.id, isDeleted: false }),
        expect.objectContaining({ id: stopped.id, isDeleted: true }),
      ]),
    );
  });

  it("rejects a handle already used by another character", async () => {
    const existing = makeCharacter("character-1");
    const { service } = makeService([existing]);

    await expect(service.create(REQUEST, OWNER)).rejects.toBeInstanceOf(
      CharacterHandleConflictError,
    );
  });

  it("rejects an unknown model profile", async () => {
    const { service } = makeService([], []);

    await expect(service.create(REQUEST, OWNER)).rejects.toBeInstanceOf(
      ModelProfileNotFoundError,
    );
  });

  it("rejects an update for an unknown character", async () => {
    const { service } = makeService();

    await expect(service.update("missing", REQUEST, OWNER)).rejects.toBeInstanceOf(
      CharacterNotFoundError,
    );
  });

  it("deletes an existing character", async () => {
    const existing = makeCharacter("character-1");
    const { service, characters } = makeService([existing]);

    await expect(service.delete(existing.id, OWNER)).resolves.toBe(existing.id);
    expect(characters).toEqual([]);
  });

  it("rejects deletion of an unknown character", async () => {
    const { service } = makeService();

    await expect(service.delete("missing", OWNER)).rejects.toBeInstanceOf(
      CharacterNotFoundError,
    );
  });

  it("restores a logically deleted character", async () => {
    const stopped = {
      ...makeCharacter("character-stopped"),
      deletedAt: new Date("2026-01-01T00:00:00Z"),
    };
    const { service, characters } = makeService([stopped]);

    await expect(service.restore(stopped.id, OWNER)).resolves.toBe(stopped.id);
    expect(characters[0]?.deletedAt).toBeUndefined();
    await expect(service.listDtos(OWNER)).resolves.toHaveLength(1);
  });

  it("bulk deletes existing unique ids and ignores missing ids", async () => {
    const first = makeCharacter("character-1");
    const second = makeCharacter("character-2", { ...REQUEST, handle: "second" });
    const { service, characters } = makeService([first, second]);

    await expect(
      service.deleteMany([first.id, first.id, "missing"], OWNER),
    ).resolves.toEqual([first.id]);
    expect(characters).toEqual([second]);
  });
});

describe("CharacterService ownership (CLAUDE.md §66.5)", () => {
  it("lets the creator update their own character", async () => {
    const existing = makeCharacter("character-1");
    const { service } = makeService([existing]);

    await expect(
      service.update(existing.id, { ...REQUEST, displayName: "変更後" }, OWNER),
    ).resolves.toMatchObject({ displayName: "変更後" });
  });

  it("lets an admin update someone else's character", async () => {
    const existing = makeCharacter("character-1");
    const { service } = makeService([existing]);

    await expect(
      service.update(existing.id, { ...REQUEST, displayName: "変更後" }, ADMIN),
    ).resolves.toMatchObject({ displayName: "変更後" });
  });

  it("rejects an update from a signed-in user who did not create the character", async () => {
    const existing = makeCharacter("character-1");
    const { service } = makeService([existing]);

    await expect(
      service.update(existing.id, REQUEST, OTHER_USER),
    ).rejects.toBeInstanceOf(CharacterForbiddenError);
  });

  it("rejects deletion from a non-owner, non-admin", async () => {
    const existing = makeCharacter("character-1");
    const { service } = makeService([existing]);

    await expect(service.delete(existing.id, OTHER_USER)).rejects.toBeInstanceOf(
      CharacterForbiddenError,
    );
  });

  it("rejects restoration from a non-owner, non-admin", async () => {
    const stopped = {
      ...makeCharacter("character-stopped"),
      deletedAt: new Date("2026-01-01T00:00:00Z"),
    };
    const { service } = makeService([stopped]);

    await expect(service.restore(stopped.id, OTHER_USER)).rejects.toBeInstanceOf(
      CharacterForbiddenError,
    );
  });

  it("rejects any non-admin from touching a System-owned (seed) character, owner or not", async () => {
    const seedCharacter = makeCharacter("architect", REQUEST, null);
    const { service } = makeService([seedCharacter]);

    await expect(service.update(seedCharacter.id, REQUEST, OWNER)).rejects.toBeInstanceOf(
      CharacterForbiddenError,
    );
    await expect(service.delete(seedCharacter.id, OWNER)).rejects.toBeInstanceOf(
      CharacterForbiddenError,
    );
  });

  it("lets an admin edit a System-owned (seed) character", async () => {
    const seedCharacter = makeCharacter("architect", REQUEST, null);
    const { service } = makeService([seedCharacter]);

    await expect(
      service.update(seedCharacter.id, { ...REQUEST, displayName: "変更後" }, ADMIN),
    ).resolves.toMatchObject({ displayName: "変更後" });
  });

  it("bulk-deletes only the ids the actor owns, silently dropping the rest", async () => {
    const own = makeCharacter("character-own", { ...REQUEST, handle: "own" });
    const someoneElses = makeCharacter(
      "character-other",
      { ...REQUEST, handle: "someone-elses" },
      OTHER_USER.id,
    );
    const { service, characters } = makeService([own, someoneElses]);

    await expect(
      service.deleteMany([own.id, someoneElses.id], OWNER),
    ).resolves.toEqual([own.id]);
    expect(characters).toEqual([someoneElses]);
  });

  it("lets an admin bulk-delete characters owned by anyone", async () => {
    const own = makeCharacter("character-own", { ...REQUEST, handle: "own" });
    const someoneElses = makeCharacter(
      "character-other",
      { ...REQUEST, handle: "someone-elses" },
      OTHER_USER.id,
    );
    const { service } = makeService([own, someoneElses]);

    await expect(
      service.deleteMany([own.id, someoneElses.id], ADMIN),
    ).resolves.toEqual(expect.arrayContaining([own.id, someoneElses.id]));
  });

  it("lists only the characters a given user created, including their deleted ones", async () => {
    const ownedActive = makeCharacter("character-owned", { ...REQUEST, handle: "owned" });
    const ownedDeleted = {
      ...makeCharacter("character-owned-deleted", { ...REQUEST, handle: "owned_deleted" }),
      deletedAt: new Date("2026-01-01T00:00:00Z"),
    };
    const someoneElses = makeCharacter(
      "character-other",
      { ...REQUEST, handle: "someone-elses" },
      OTHER_USER.id,
    );
    const { service } = makeService([ownedActive, ownedDeleted, someoneElses]);

    const listed = await service.listManagementDtosByCreator(OWNER.id);

    expect(listed.map((character) => character.id).sort()).toEqual(
      [ownedActive.id, ownedDeleted.id].sort(),
    );
  });

  it("includes createdByUserId in the admin drilldown list, viewed by the admin doing the drilldown", async () => {
    const owned = makeCharacter("character-owned", { ...REQUEST, handle: "owned" });
    const { service } = makeService([owned]);

    const [row] = await service.listManagementDtosByCreator(OWNER.id, ADMIN);

    expect(row?.createdByUserId).toBe(OWNER.id);
  });
});

/**
 * An ordinary caller sees only what they own (§10.7). A complete character list
 * would be a lookup table from handle to "this account is an AI", which is the
 * one thing the public surface must never make obtainable (§25).
 */
describe("CharacterService list scope", () => {
  const someoneElses = () =>
    makeCharacter("character-other", { ...REQUEST, handle: "someone_elses" }, OTHER_USER.id);
  const systemOwned = () =>
    makeCharacter("character-system", { ...REQUEST, handle: "system_owned" }, null);

  it("hides other users' and System-owned characters from an ordinary caller", async () => {
    const own = makeCharacter("character-own", { ...REQUEST, handle: "own" });
    const { service } = makeService([own, someoneElses(), systemOwned()]);

    await expect(service.listDtos(OWNER)).resolves.toEqual([
      expect.objectContaining({ id: own.id }),
    ]);
    await expect(service.listManagementDtos(OWNER)).resolves.toEqual([
      expect.objectContaining({ id: own.id }),
    ]);
  });

  it("shows an administrator every character, System-owned included", async () => {
    const own = makeCharacter("character-own", { ...REQUEST, handle: "own" });
    const { service } = makeService([own, someoneElses(), systemOwned()]);

    const listed = await service.listManagementDtos(ADMIN);

    expect(listed.map((character) => character.id).sort()).toEqual(
      ["character-other", "character-own", "character-system"].sort(),
    );
  });

  it("labels the creator for an administrator, with null standing for System-owned", async () => {
    const { service } = makeService([someoneElses(), systemOwned()]);

    const listed = await service.listManagementDtos(ADMIN);

    expect(listed.find((row) => row.id === "character-other")?.creator).toEqual({
      id: OTHER_USER.id,
      handle: `handle_${OTHER_USER.id}`,
      displayName: `User ${OTHER_USER.id}`,
    });
    expect(listed.find((row) => row.id === "character-system")?.creator).toBeNull();
  });

  it("omits creator entirely for an ordinary caller, whose list is their own by definition", async () => {
    const own = makeCharacter("character-own", { ...REQUEST, handle: "own" });
    const { service } = makeService([own]);

    const [row] = await service.listManagementDtos(OWNER);

    expect(row).not.toHaveProperty("creator");
  });

  it("hides another user's character behind a 404 rather than a 403, for both reads", async () => {
    const { service } = makeService([someoneElses()]);

    // Not `CharacterForbiddenError`: a 403 would confirm the id belongs to a
    // character, and that alone sorts accounts into people and AI (§25).
    await expect(service.findDto("character-other", OWNER)).resolves.toBeNull();
    await expect(service.findConfigDto("character-other", OWNER)).resolves.toBeNull();
  });

  it("still gives the creator and an administrator the config they may edit", async () => {
    const own = makeCharacter("character-own", { ...REQUEST, handle: "own" });
    const { service } = makeService([own]);

    await expect(service.findConfigDto(own.id, OWNER)).resolves.toMatchObject({ id: own.id });
    await expect(service.findConfigDto(own.id, ADMIN)).resolves.toMatchObject({ id: own.id });
  });
});
