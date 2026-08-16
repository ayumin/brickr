import { describe, expect, it, vi } from "vitest";
import type { Db, DbTransaction } from "../persistence/prisma.js";
import { LLMBudgetRepository } from "./llm-budget-repository.js";

describe("LLMBudgetRepository.recordUsageAndIncrement", () => {
  it("runs the usage log and aggregate update on the same transaction client", async () => {
    const updated = {
      provider: "openai",
      tokenLimit: 1_000,
      totalTokens: 250,
      stopped: false,
    };
    const createUsage = vi.fn(() => Promise.resolve({ id: "usage-1" }));
    const upsertBudget = vi.fn(() => Promise.resolve(updated));
    const executeRaw = vi.fn(() => Promise.resolve(1));
    const findBudget = vi.fn(() => Promise.resolve(updated));
    const tx = {
      lLMUsage: { create: createUsage },
      lLMBudget: { upsert: upsertBudget, findUniqueOrThrow: findBudget },
      $executeRaw: executeRaw,
    } as unknown as DbTransaction;
    const transaction = vi.fn(async (callback: (client: DbTransaction) => Promise<unknown>) =>
      callback(tx),
    );
    const repository = new LLMBudgetRepository({ $transaction: transaction } as unknown as Db);

    await expect(
      repository.recordUsageAndIncrement("openai", 250, "room-1"),
    ).resolves.toEqual(updated);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(createUsage).toHaveBeenCalledWith({
      data: { provider: "openai", totalTokens: 250, roomId: "room-1" },
    });
    expect(upsertBudget).toHaveBeenCalledWith({
      where: { provider: "openai" },
      create: { provider: "openai", totalTokens: 0 },
      update: {},
    });
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(findBudget).toHaveBeenCalledWith({ where: { provider: "openai" } });
  });
});
