import { describe, expect, it, vi } from "vitest";
import type { DbTransaction } from "../persistence/prisma.js";
import { repairThreads } from "./thread-repair.js";

type PostFixture = {
  id: string;
  simulationId: string;
  replyTo: string | null;
  createdAt: Date;
  threadRootId: string;
  threadActivityAt: Date;
};

function at(day: number): Date {
  return new Date(`2026-08-${String(day).padStart(2, "0")}T00:00:00Z`);
}

/**
 * An in-memory stand-in for the transaction client, holding the posts that
 * survived a hard delete. Faithful enough to catch the mistakes that matter:
 * a subtree left pointing at a deleted root, or an activity time invented
 * rather than derived.
 */
function makeTx(posts: PostFixture[]) {
  const simulationCreatedAt = at(1);

  const tx = {
    post: {
      findMany: vi.fn(({ where }: { where: { replyTo: { in: string[] } } }) =>
        Promise.resolve(
          posts
            .filter((post) => post.replyTo !== null && where.replyTo.in.includes(post.replyTo))
            .map((post) => ({ id: post.id })),
        ),
      ),
      updateMany: vi.fn(
        ({
          where,
          data,
        }: {
          where: { id: { in: string[] } };
          data: { threadRootId: string };
        }) => {
          for (const post of posts) {
            if (where.id.in.includes(post.id)) post.threadRootId = data.threadRootId;
          }
          return Promise.resolve({ count: where.id.in.length });
        },
      ),
      update: vi.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: { threadActivityAt: Date };
        }) => {
          const target = posts.find((post) => post.id === where.id);
          if (target) target.threadActivityAt = data.threadActivityAt;
          return Promise.resolve({});
        },
      ),
      aggregate: vi.fn(
        ({
          where,
        }: {
          where: { id?: { in: string[] }; simulationId?: string; replyTo?: null };
        }) => {
          const scope = where.id
            ? posts.filter((post) => where.id?.in.includes(post.id))
            : posts.filter(
                (post) => post.simulationId === where.simulationId && post.replyTo === null,
              );
          return Promise.resolve({
            _max: {
              createdAt: maxOf(scope.map((post) => post.createdAt)),
              threadActivityAt: maxOf(scope.map((post) => post.threadActivityAt)),
            },
          });
        },
      ),
    },
    simulation: {
      findUnique: vi.fn(() => Promise.resolve({ createdAt: simulationCreatedAt })),
      update: vi.fn(() => Promise.resolve({})),
    },
  };

  return { tx: tx as unknown as DbTransaction, spies: tx, posts, simulationCreatedAt };
}

function maxOf(dates: Date[]): Date | null {
  return dates.length === 0
    ? null
    : dates.reduce((newest, date) => (date > newest ? date : newest));
}

function post(overrides: Partial<PostFixture> & { id: string }): PostFixture {
  return {
    simulationId: "sim-1",
    replyTo: null,
    createdAt: at(2),
    threadRootId: "deleted-root",
    threadActivityAt: at(2),
    ...overrides,
  };
}

describe("repairThreads after a hard delete (§8.5)", () => {
  it("promotes an orphaned reply to root and rebases its whole subtree", async () => {
    const { tx, posts } = makeTx([
      post({ id: "orphan", createdAt: at(3), threadActivityAt: at(3) }),
      post({ id: "child", replyTo: "orphan", createdAt: at(4), threadActivityAt: at(4) }),
      post({ id: "grandchild", replyTo: "child", createdAt: at(5), threadActivityAt: at(5) }),
    ]);

    await repairThreads(tx, {
      newRootIds: ["orphan"],
      detachedRootIds: [],
      simulationIds: ["sim-1"],
    });

    expect(posts.map((entry) => entry.threadRootId)).toEqual(["orphan", "orphan", "orphan"]);
  });

  it("dates the new root from its newest surviving post, not from now", async () => {
    const { tx, posts, spies } = makeTx([
      post({ id: "orphan", createdAt: at(3), threadActivityAt: at(3) }),
      post({ id: "child", replyTo: "orphan", createdAt: at(6), threadActivityAt: at(6) }),
    ]);

    await repairThreads(tx, {
      newRootIds: ["orphan"],
      detachedRootIds: [],
      simulationIds: ["sim-1"],
    });

    expect(posts[0]?.threadActivityAt).toEqual(at(6));
    expect(spies.simulation.update).toHaveBeenCalledWith({
      where: { id: "sim-1" },
      data: { lastActivityAt: at(6) },
    });
  });

  it("keeps separate orphan subtrees separate", async () => {
    const { tx, posts } = makeTx([
      post({ id: "orphan-a" }),
      post({ id: "child-a", replyTo: "orphan-a" }),
      post({ id: "orphan-b" }),
      post({ id: "child-b", replyTo: "orphan-b" }),
    ]);

    await repairThreads(tx, {
      newRootIds: ["orphan-a", "orphan-b"],
      detachedRootIds: [],
      simulationIds: ["sim-1"],
    });

    expect(posts.map((entry) => `${entry.id}->${entry.threadRootId}`)).toEqual([
      "orphan-a->orphan-a",
      "child-a->orphan-a",
      "orphan-b->orphan-b",
      "child-b->orphan-b",
    ]);
  });

  it("falls back to the room's creation time when every post is gone", async () => {
    const { tx, spies, simulationCreatedAt } = makeTx([]);

    await repairThreads(tx, {
      newRootIds: [],
      detachedRootIds: [],
      simulationIds: ["sim-1"],
    });

    expect(spies.simulation.update).toHaveBeenCalledWith({
      where: { id: "sim-1" },
      data: { lastActivityAt: simulationCreatedAt },
    });
  });

  /**
   * The root the orphaned subtree hung under can survive the delete. Its
   * `threadActivityAt` was pushed forward by the replies below it, so once part of
   * the thread leaves it is crediting activity it no longer contains.
   */
  it("re-dates the surviving root the orphaned subtree was cut from", async () => {
    const { tx, posts, spies } = makeTx([
      // The deleted reply sat between these two, so `root` kept being bumped to
      // `orphan`'s creation time while `orphan` belonged to its thread.
      post({ id: "root", createdAt: at(2), threadRootId: "root", threadActivityAt: at(7) }),
      post({ id: "orphan", createdAt: at(7), threadActivityAt: at(7) }),
    ]);

    await repairThreads(tx, {
      newRootIds: ["orphan"],
      detachedRootIds: ["root"],
      simulationIds: ["sim-1"],
    });

    expect(posts[0]?.threadActivityAt).toEqual(at(2));
    expect(posts[1]?.threadActivityAt).toEqual(at(7));
    // The room is still as recent as the promoted thread, just not because of `root`.
    expect(spies.simulation.update).toHaveBeenCalledWith({
      where: { id: "sim-1" },
      data: { lastActivityAt: at(7) },
    });
  });

  it("keeps the replies that stayed behind when it re-dates that root", async () => {
    const { tx, posts } = makeTx([
      post({ id: "root", createdAt: at(2), threadRootId: "root", threadActivityAt: at(7) }),
      post({
        id: "kept-reply",
        replyTo: "root",
        createdAt: at(4),
        threadRootId: "root",
        threadActivityAt: at(4),
      }),
      post({ id: "orphan", createdAt: at(7), threadActivityAt: at(7) }),
    ]);

    await repairThreads(tx, {
      newRootIds: ["orphan"],
      detachedRootIds: ["root"],
      simulationIds: ["sim-1"],
    });

    expect(posts[0]?.threadActivityAt).toEqual(at(4));
    expect(posts[1]?.threadRootId).toBe("root");
  });

  it("leaves a root that was deleted along with the character alone", async () => {
    const { tx, spies } = makeTx([
      post({ id: "orphan", createdAt: at(3), threadActivityAt: at(3) }),
    ]);

    await repairThreads(tx, {
      newRootIds: ["orphan"],
      detachedRootIds: ["deleted-root"],
      simulationIds: ["sim-1"],
    });

    // Nothing survives under it to aggregate, so it is never updated into a
    // `RecordNotFound`.
    expect(spies.post.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "deleted-root" } }),
    );
  });
});
