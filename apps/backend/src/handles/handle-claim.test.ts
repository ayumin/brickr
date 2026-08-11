import { describe, expect, it } from "vitest";
import type { DbTransaction } from "../persistence/prisma.js";
import { claimHandle, releaseHandles } from "./handle-claim.js";
import { HandleTakenError } from "./handle.js";

type Row = { handle: string; ownerType: string; ownerId: string };

/**
 * In-memory stand-in for the transaction client. It enforces the primary key on
 * `handle`, which is the constraint the production code relies on.
 */
function makeTx(initial: Row[] = []) {
  const rows = [...initial];

  const tx = {
    handleOwner: {
      deleteMany: ({
        where,
      }: {
        where: { ownerType: string; ownerId: string | { in: string[] } };
      }) => {
        const ids =
          typeof where.ownerId === "string" ? [where.ownerId] : where.ownerId.in;
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          const row = rows[index];
          if (row && row.ownerType === where.ownerType && ids.includes(row.ownerId)) {
            rows.splice(index, 1);
          }
        }
        return Promise.resolve({ count: 0 });
      },
      create: ({ data }: { data: Row }) => {
        if (rows.some((row) => row.handle === data.handle)) {
          return Promise.reject(Object.assign(new Error("unique"), { code: "P2002" }));
        }
        rows.push(data);
        return Promise.resolve(data);
      },
    },
  } as unknown as DbTransaction;

  return { tx, rows };
}

describe("claimHandle", () => {
  it("takes a free handle", async () => {
    const { tx, rows } = makeTx();

    await claimHandle(tx, { handle: "architect", ownerType: "character", ownerId: "c1" });

    expect(rows).toEqual([{ handle: "architect", ownerType: "character", ownerId: "c1" }]);
  });

  it("normalizes the handle before storing it", async () => {
    const { tx, rows } = makeTx();

    await claimHandle(tx, { handle: "@Architect", ownerType: "user", ownerId: "u1" });

    expect(rows[0]?.handle).toBe("architect");
  });

  it("refuses a handle held by the other owner kind (§66.13)", async () => {
    const { tx } = makeTx([{ handle: "architect", ownerType: "character", ownerId: "c1" }]);

    await expect(
      claimHandle(tx, { handle: "architect", ownerType: "user", ownerId: "u1" }),
    ).rejects.toBeInstanceOf(HandleTakenError);
  });

  it("renames by releasing the old handle and taking the new one", async () => {
    const { tx, rows } = makeTx([{ handle: "old", ownerType: "character", ownerId: "c1" }]);

    await claimHandle(tx, { handle: "new", ownerType: "character", ownerId: "c1" });

    expect(rows).toEqual([{ handle: "new", ownerType: "character", ownerId: "c1" }]);
  });

  it("lets an owner re-claim the handle it already holds", async () => {
    const { tx, rows } = makeTx([{ handle: "architect", ownerType: "character", ownerId: "c1" }]);

    await claimHandle(tx, { handle: "architect", ownerType: "character", ownerId: "c1" });

    expect(rows).toEqual([{ handle: "architect", ownerType: "character", ownerId: "c1" }]);
  });

  it("rethrows errors that are not constraint violations", async () => {
    const tx = {
      handleOwner: {
        deleteMany: () => Promise.resolve({ count: 0 }),
        create: () => Promise.reject(new Error("connection lost")),
      },
    } as unknown as DbTransaction;

    await expect(
      claimHandle(tx, { handle: "architect", ownerType: "character", ownerId: "c1" }),
    ).rejects.toThrow("connection lost");
  });
});

describe("releaseHandles", () => {
  it("frees the handles of the given owners", async () => {
    const { tx, rows } = makeTx([
      { handle: "a", ownerType: "character", ownerId: "c1" },
      { handle: "b", ownerType: "character", ownerId: "c2" },
      { handle: "c", ownerType: "user", ownerId: "c1" },
    ]);

    await releaseHandles(tx, "character", ["c1", "c2"]);

    // The user row keeps its handle even though it shares an owner id.
    expect(rows).toEqual([{ handle: "c", ownerType: "user", ownerId: "c1" }]);
  });

  it("does nothing for an empty list", async () => {
    const { tx, rows } = makeTx([{ handle: "a", ownerType: "character", ownerId: "c1" }]);

    await releaseHandles(tx, "character", []);

    expect(rows).toHaveLength(1);
  });
});
