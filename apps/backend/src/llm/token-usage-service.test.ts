import { describe, expect, it } from "vitest";
import type { TokenUsageRepository, TokenUsageTotals } from "./token-usage-repository.js";
import { TokenUsageService } from "./token-usage-service.js";

function makeService() {
  const totals = new Map<string, TokenUsageTotals>();

  const repository = {
    record: (userId: string, usage: TokenUsageTotals) => {
      const current = totals.get(userId) ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
      totals.set(userId, {
        inputTokens: current.inputTokens + usage.inputTokens,
        outputTokens: current.outputTokens + usage.outputTokens,
        totalTokens: current.totalTokens + usage.totalTokens,
      });
      return Promise.resolve();
    },
    findByUserId: (userId: string) => Promise.resolve(totals.get(userId) ?? null),
  } as unknown as TokenUsageRepository;

  return { service: new TokenUsageService(repository), totals };
}

describe("TokenUsageService.getDto", () => {
  it("returns zeros for a user who has never triggered a generation", async () => {
    const { service } = makeService();

    await expect(service.getDto("user-1")).resolves.toEqual({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
    });
  });

  it("reflects accumulated usage after recording", async () => {
    const { service } = makeService();

    await service.record("user-1", { inputTokens: 10, outputTokens: 20, totalTokens: 30 });
    await service.record("user-1", { inputTokens: 5, outputTokens: 5, totalTokens: 10 });

    await expect(service.getDto("user-1")).resolves.toEqual({
      totalInputTokens: 15,
      totalOutputTokens: 25,
      totalTokens: 40,
    });
  });

  it("keeps each user's usage separate", async () => {
    const { service } = makeService();

    await service.record("user-1", { inputTokens: 10, outputTokens: 10, totalTokens: 20 });
    await service.record("user-2", { inputTokens: 1, outputTokens: 1, totalTokens: 2 });

    await expect(service.getDto("user-2")).resolves.toEqual({
      totalInputTokens: 1,
      totalOutputTokens: 1,
      totalTokens: 2,
    });
  });
});
