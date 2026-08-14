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

type PostFindManyArgs = {
  where: { authorId?: { in?: string[]; notIn?: string[] }; replyTo?: { in: string[] } };
};

/**
 * Mocks the interactive transaction client the repository now asks for.
 *
 * `postFindMany` answers by intent rather than by call order, so a change in the
 * number of queries the repair walk makes does not silently rewire the test.
 */
function makeDb(
  postFindMany: (
    args: PostFindManyArgs,
  ) => Array<{ id: string; simulationId?: string; threadRootId?: string }> = () => [],
) {
  const tx = {
    post: {
      deleteMany: vi.fn(() => Promise.resolve({ count: 3 })),
      findMany: vi.fn((args: PostFindManyArgs) => Promise.resolve(postFindMany(args))),
      updateMany: vi.fn(() => Promise.resolve({ count: 0 })),
      update: vi.fn(() => Promise.resolve({})),
      aggregate: vi.fn(() =>
        Promise.resolve({ _max: { createdAt: null, threadActivityAt: null } }),
      ),
    },
    simulation: {
      update: vi.fn(() => Promise.resolve({})),
      findUnique: vi.fn(() =>
        Promise.resolve({ createdAt: new Date("2026-08-01T00:00:00Z") }),
      ),
    },
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

    await new CharacterRepository(db).create("character-1", saveCharacter, "user-1");

    expect(tx.character.create).toHaveBeenCalledTimes(1);
    expect(tx.character.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ createdByUserId: "user-1" }) }),
    );
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
      { id: "c1", input: { ...saveCharacter, handle: "one" }, createdByUserId: "user-1" },
      { id: "c2", input: { ...saveCharacter, handle: "two" }, createdByUserId: "user-1" },
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

  /**
   * The ordering is the whole trick (§8.5): the database nulls `replyTo` on the
   * surviving replies, so once the delete has run there is nothing left to
   * identify the posts that just lost their parent.
   */
  it("reads the replies it orphans before deleting, and repairs them after", async () => {
    const calls: string[] = [];
    const { db, tx } = makeDb((args) => {
      if (args.where.authorId?.in) {
        calls.push("read-doomed");
        return [{ id: "root-1", simulationId: "sim-1", threadRootId: "root-1" }];
      }
      if (args.where.authorId?.notIn) {
        calls.push("read-orphans");
        return [{ id: "reply-1" }];
      }
      calls.push("walk-subtree");
      return [];
    });
    tx.post.deleteMany.mockImplementation(() => {
      calls.push("delete");
      return Promise.resolve({ count: 1 });
    });

    await new CharacterRepository(db).hardDeleteMany(["character-1"]);

    expect(calls.slice(0, 3)).toEqual(["read-doomed", "read-orphans", "delete"]);
    expect(tx.post.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["reply-1"] } },
      data: { threadRootId: "reply-1" },
    });
    // Other accounts' replies survive; only the deleted character's posts go.
    expect(tx.post.deleteMany).toHaveBeenCalledWith({
      where: { authorId: { in: ["character-1"] } },
    });
    expect(tx.simulation.update).toHaveBeenCalledWith({
      where: { id: "sim-1" },
      data: { lastActivityAt: new Date("2026-08-01T00:00:00Z") },
    });
  });

  /**
   * The thread a deleted reply belonged to is only recorded on the reply itself,
   * so its root has to be read before the delete as well — otherwise the root
   * keeps the activity time the now-detached subtree earned it (§8.5).
   */
  it("reads the root of each deleted post, so a surviving root can be re-dated", async () => {
    const { db, tx } = makeDb((args) => {
      if (args.where.authorId?.in) {
        return [{ id: "reply-1", simulationId: "sim-1", threadRootId: "root-1" }];
      }
      if (args.where.authorId?.notIn) return [{ id: "reply-2" }];
      return [];
    });

    await new CharacterRepository(db).hardDeleteMany(["character-1"]);

    expect(tx.post.findMany).toHaveBeenCalledWith({
      where: { authorId: { in: ["character-1"] } },
      select: { id: true, simulationId: true, threadRootId: true },
    });
    // The surviving root is walked for what is left of its thread, the deleted
    // reply is not.
    expect(tx.post.findMany).toHaveBeenCalledWith({
      where: { replyTo: { in: ["root-1"] } },
      select: { id: true },
    });
    expect(tx.post.findMany).not.toHaveBeenCalledWith({
      where: { replyTo: { in: ["reply-1"] } },
      select: { id: true },
    });
  });
});
