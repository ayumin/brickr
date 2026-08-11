import { describe, expect, it, vi } from "vitest";
import type { Db, DbTransaction } from "../persistence/prisma.js";
import { CharacterRepository } from "./character-repository.js";
import type { SaveCharacter } from "./character.js";

const saveCharacter: SaveCharacter = {
  handle: "architect",
  displayName: "アーキテクト",
  description: "設計の話をする",
  rolePrompt: "role",
  tonePrompt: "tone",
  interests: [],
  activityLevel: 0.5,
  responseProbability: 0.5,
  replyProbability: 0.6,
  quoteProbability: 0.2,
  influence: 0.5,
  modelProfileId: "model-1",
};

function characterRow(id: string) {
  return {
    id,
    ...saveCharacter,
    dialectPrompt: null,
    avatarUrl: null,
    deletedAt: null,
  };
}

/** Mocks the interactive transaction client the repository now asks for. */
function makeDb() {
  const tx = {
    post: { deleteMany: vi.fn(() => Promise.resolve({ count: 3 })) },
    character: {
      create: vi.fn(({ data }: { data: { id: string } }) =>
        Promise.resolve(characterRow(data.id)),
      ),
      update: vi.fn(() => Promise.resolve(characterRow("character-1"))),
      deleteMany: vi.fn(() => Promise.resolve({ count: 1 })),
    },
    handleOwner: {
      create: vi.fn(() => Promise.resolve({})),
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
    },
  };

  const db = {
    character: { update: vi.fn(() => Promise.resolve(characterRow("character-1"))) },
    $transaction: vi.fn((run: (client: DbTransaction) => Promise<unknown>) =>
      run(tx as unknown as DbTransaction),
    ),
  } as unknown as Db;

  return { db, tx };
}

describe("CharacterRepository handle claims", () => {
  it("claims the handle in the same transaction as the new row (§66.13)", async () => {
    const { db, tx } = makeDb();

    await new CharacterRepository(db).create("character-1", saveCharacter);

    expect(tx.character.create).toHaveBeenCalledTimes(1);
    expect(tx.handleOwner.create).toHaveBeenCalledWith({
      data: { handle: "architect", ownerType: "character", ownerId: "character-1" },
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("re-claims the handle when a character is updated", async () => {
    const { db, tx } = makeDb();

    await new CharacterRepository(db).update("character-1", {
      ...saveCharacter,
      handle: "renamed",
    });

    // The release of the previous handle is what makes a rename safe.
    expect(tx.handleOwner.deleteMany).toHaveBeenCalledWith({
      where: { ownerType: "character", ownerId: "character-1" },
    });
    expect(tx.handleOwner.create).toHaveBeenCalledWith({
      data: { handle: "renamed", ownerType: "character", ownerId: "character-1" },
    });
  });

  it("claims a handle for every row of a bulk create", async () => {
    const { db, tx } = makeDb();

    await new CharacterRepository(db).createMany([
      { id: "c1", input: { ...saveCharacter, handle: "one" } },
      { id: "c2", input: { ...saveCharacter, handle: "two" } },
    ]);

    expect(tx.handleOwner.create).toHaveBeenCalledTimes(2);
  });

  it("keeps the handle reserved on soft deletion (§48)", async () => {
    const { db, tx } = makeDb();

    await new CharacterRepository(db).delete("character-1");

    expect(tx.handleOwner.deleteMany).not.toHaveBeenCalled();
  });
});

describe("CharacterRepository hard deletion", () => {
  it("deletes authored posts, characters and their handles in one transaction", async () => {
    const { db, tx } = makeDb();

    await new CharacterRepository(db).hardDeleteMany(["character-1"]);

    expect(tx.post.deleteMany).toHaveBeenCalledWith({
      where: { authorId: { in: ["character-1"] } },
    });
    expect(tx.character.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["character-1"] } },
    });
    expect(tx.handleOwner.deleteMany).toHaveBeenCalledWith({
      where: { ownerType: "character", ownerId: { in: ["character-1"] } },
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});
