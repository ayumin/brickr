import { describe, expect, it, vi } from "vitest";
import type { Db } from "../persistence/prisma.js";
import { CharacterRepository } from "./character-repository.js";

describe("CharacterRepository hard deletion", () => {
  it("deletes authored posts and characters in one transaction", async () => {
    const postDelete = Promise.resolve({ count: 3 });
    const characterDelete = Promise.resolve({ count: 1 });
    const db = {
      post: { deleteMany: vi.fn(() => postDelete) },
      character: { deleteMany: vi.fn(() => characterDelete) },
      $transaction: vi.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
    } as unknown as Db;

    await new CharacterRepository(db).hardDeleteMany(["character-1"]);

    expect(db.post.deleteMany).toHaveBeenCalledWith({
      where: { authorId: { in: ["character-1"] } },
    });
    expect(db.character.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["character-1"] } },
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});
