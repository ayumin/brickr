import { describe, expect, it } from "vitest";
import type { BudgetRow, LLMBudgetRepository } from "./llm-budget-repository.js";
import { LLMBudgetService, InvalidBudgetError } from "./llm-budget-service.js";

// ---------------------------------------------------------------------------
// In-memory fake repository
// ---------------------------------------------------------------------------

function makeFakeRepository() {
  const budgets = new Map<string, BudgetRow>();
  const usageLog: Array<{ provider: string; totalTokens: number; roomId: string | null }> = [];

  const repository: LLMBudgetRepository = {
    findByProvider: (provider: string) => Promise.resolve(budgets.get(provider) ?? null),

    findAll: () =>
      Promise.resolve(
        [...budgets.values()].sort((a, b) => a.provider.localeCompare(b.provider)),
      ),

    setLimit: (provider: string, tokenLimit: number) => {
      const existing = budgets.get(provider) ?? {
        provider,
        tokenLimit: 0,
        totalTokens: 0,
        stopped: false,
      };
      budgets.set(provider, { ...existing, tokenLimit });
      return Promise.resolve();
    },

    reset: (provider: string) => {
      const existing = budgets.get(provider) ?? {
        provider,
        tokenLimit: 0,
        totalTokens: 0,
        stopped: false,
      };
      const updated: BudgetRow = { ...existing, totalTokens: 0, stopped: false };
      budgets.set(provider, updated);
      return Promise.resolve(updated);
    },

    recordUsageAndIncrement: (provider: string, totalTokens: number, roomId: string | null) => {
      usageLog.push({ provider, totalTokens, roomId });
      const existing = budgets.get(provider) ?? {
        provider,
        tokenLimit: 0,
        totalTokens: 0,
        stopped: false,
      };
      const newTotal = existing.totalTokens + totalTokens;
      const updated: BudgetRow = {
        ...existing,
        totalTokens: newTotal,
        stopped:
          existing.stopped ||
          (existing.tokenLimit > 0 && newTotal >= existing.tokenLimit),
      };
      budgets.set(provider, updated);
      return Promise.resolve(updated);
    },

    sumByRoom: (provider: string, roomId: string) => {
      const total = usageLog
        .filter((e) => e.provider === provider && e.roomId === roomId)
        .reduce((sum, e) => sum + e.totalTokens, 0);
      return Promise.resolve(total);
    },

    sumAllByRoom: (roomId: string) => {
      const total = usageLog
        .filter((e) => e.roomId === roomId)
        .reduce((sum, e) => sum + e.totalTokens, 0);
      return Promise.resolve(total);
    },

    isStopped: (provider: string) =>
      Promise.resolve(budgets.get(provider)?.stopped ?? false),
  } as unknown as LLMBudgetRepository;

  return { repository, budgets, usageLog };
}

function makeService() {
  const { repository, budgets, usageLog } = makeFakeRepository();
  return { service: new LLMBudgetService(repository), budgets, usageLog };
}

// ---------------------------------------------------------------------------
// isAllowed
// ---------------------------------------------------------------------------

describe("LLMBudgetService.isAllowed", () => {
  it("returns true when no budget row exists (no limit configured)", async () => {
    const { service } = makeService();
    await expect(service.isAllowed("openai")).resolves.toBe(true);
  });

  it("returns true when the provider has a limit but has not exceeded it", async () => {
    const { service } = makeService();
    await service.setLimit({ provider: "openai", tokenLimit: 1_000_000 });
    await service.recordUsage("openai", 500_000, null);
    await expect(service.isAllowed("openai")).resolves.toBe(true);
  });

  it("returns false when the provider is stopped", async () => {
    const { service } = makeService();
    await service.setLimit({ provider: "openai", tokenLimit: 100 });
    // Exceed the limit
    await service.recordUsage("openai", 101, null);
    await expect(service.isAllowed("openai")).resolves.toBe(false);
  });

  it("keeps each provider's stopped state independent", async () => {
    const { service } = makeService();
    await service.setLimit({ provider: "openai", tokenLimit: 100 });
    await service.recordUsage("openai", 101, null);

    // anthropic has no limit — should still be allowed
    await expect(service.isAllowed("anthropic")).resolves.toBe(true);
  });
});

// ---------------------------------------------------------------------------
// recordUsage
// ---------------------------------------------------------------------------

describe("LLMBudgetService.recordUsage", () => {
  it("writes a per-room log entry", async () => {
    const { service, usageLog } = makeService();
    await service.recordUsage("openai", 500, "room-1");
    expect(usageLog).toHaveLength(1);
    expect(usageLog[0]).toMatchObject({ provider: "openai", totalTokens: 500, roomId: "room-1" });
  });

  it("increments the global aggregate", async () => {
    const { service, budgets } = makeService();
    await service.setLimit({ provider: "openai", tokenLimit: 1_000_000 });
    await service.recordUsage("openai", 300, null);
    await service.recordUsage("openai", 200, "room-1");
    expect(budgets.get("openai")?.totalTokens).toBe(500);
  });

  it("stops the provider when the limit is exactly reached", async () => {
    const { service, budgets } = makeService();
    await service.setLimit({ provider: "openai", tokenLimit: 1_000 });
    await service.recordUsage("openai", 1_000, null);
    expect(budgets.get("openai")?.stopped).toBe(true);
  });

  it("stops the provider when the limit is exceeded", async () => {
    const { service, budgets } = makeService();
    await service.setLimit({ provider: "openai", tokenLimit: 1_000 });
    await service.recordUsage("openai", 1_001, null);
    expect(budgets.get("openai")?.stopped).toBe(true);
  });

  it("does not stop the provider when there is no limit (tokenLimit = 0)", async () => {
    const { service, budgets } = makeService();
    // No setLimit call — tokenLimit defaults to 0 (no limit)
    await service.recordUsage("openai", 999_999_999, null);
    expect(budgets.get("openai")?.stopped).toBe(false);
  });

  it("keeps stopped = true once set, even after further usage", async () => {
    const { service, budgets } = makeService();
    await service.setLimit({ provider: "openai", tokenLimit: 100 });
    await service.recordUsage("openai", 101, null);
    await service.recordUsage("openai", 1, null);
    expect(budgets.get("openai")?.stopped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

describe("LLMBudgetService.reset", () => {
  it("clears the stopped flag", async () => {
    const { service } = makeService();
    await service.setLimit({ provider: "openai", tokenLimit: 100 });
    await service.recordUsage("openai", 101, null);
    expect(await service.isAllowed("openai")).toBe(false);

    await service.reset("openai");
    expect(await service.isAllowed("openai")).toBe(true);
  });

  it("zeroes the total token count", async () => {
    const { service, budgets } = makeService();
    await service.setLimit({ provider: "openai", tokenLimit: 1_000_000 });
    await service.recordUsage("openai", 500_000, null);
    await service.reset("openai");
    expect(budgets.get("openai")?.totalTokens).toBe(0);
  });

  it("preserves the token limit after reset", async () => {
    const { service, budgets } = makeService();
    await service.setLimit({ provider: "openai", tokenLimit: 1_000_000 });
    await service.recordUsage("openai", 1_000_001, null);
    await service.reset("openai");
    expect(budgets.get("openai")?.tokenLimit).toBe(1_000_000);
  });

  it("returns the updated budget DTO", async () => {
    const { service } = makeService();
    await service.setLimit({ provider: "openai", tokenLimit: 100 });
    await service.recordUsage("openai", 101, null);
    const dto = await service.reset("openai");
    expect(dto).toMatchObject({
      provider: "openai",
      totalTokens: 0,
      stopped: false,
      tokenLimit: 100,
    });
  });

  it("works even when no budget row exists yet (creates a zeroed row)", async () => {
    const { service } = makeService();
    const dto = await service.reset("anthropic");
    expect(dto).toMatchObject({
      provider: "anthropic",
      totalTokens: 0,
      stopped: false,
    });
  });
});

// ---------------------------------------------------------------------------
// setLimit
// ---------------------------------------------------------------------------

describe("LLMBudgetService.setLimit", () => {
  it("rejects a negative token limit", async () => {
    const { service } = makeService();
    await expect(
      service.setLimit({ provider: "openai", tokenLimit: -1 }),
    ).rejects.toBeInstanceOf(InvalidBudgetError);
  });

  it("accepts 0 (no limit)", async () => {
    const { service } = makeService();
    await expect(
      service.setLimit({ provider: "openai", tokenLimit: 0 }),
    ).resolves.toMatchObject({ tokenLimit: 0 });
  });

  it("returns the updated budget DTO", async () => {
    const { service } = makeService();
    const dto = await service.setLimit({ provider: "openai", tokenLimit: 500_000 });
    expect(dto).toMatchObject({ provider: "openai", tokenLimit: 500_000 });
  });
});

// ---------------------------------------------------------------------------
// getAll
// ---------------------------------------------------------------------------

describe("LLMBudgetService.getAll", () => {
  it("returns an empty list when no budgets are configured", async () => {
    const { service } = makeService();
    const result = await service.getAll();
    expect(result.providers).toHaveLength(0);
  });

  it("returns all configured providers sorted by name", async () => {
    const { service } = makeService();
    await service.setLimit({ provider: "openai", tokenLimit: 1_000_000 });
    await service.setLimit({ provider: "anthropic", tokenLimit: 500_000 });
    const result = await service.getAll();
    expect(result.providers.map((p) => p.provider)).toEqual(["anthropic", "openai"]);
  });
});
