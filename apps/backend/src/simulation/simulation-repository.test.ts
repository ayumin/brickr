import { describe, expect, it, vi } from "vitest";
import type { Db } from "../persistence/prisma.js";
import { SimulationRepository } from "./simulation-repository.js";

describe("SimulationRepository history", () => {
  it("requests newest simulations first and maps post counts", async () => {
    const createdAt = new Date("2026-08-10T01:02:03.000Z");
    const findMany = vi.fn(() =>
      Promise.resolve([
        {
          id: "simulation-1",
          title: "履歴",
          status: "active",
          createdAt,
          updatedAt: createdAt,
          _count: { posts: 42 },
        },
      ]),
    );
    const db = { simulation: { findMany } } as unknown as Db;

    await expect(new SimulationRepository(db).findAll()).resolves.toEqual([
      {
        id: "simulation-1",
        title: "履歴",
        status: "active",
        createdAt,
        postCount: 42,
      },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      include: { _count: { select: { posts: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  });
});
