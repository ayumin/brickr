import { describe, expect, it, vi } from "vitest";
import type { Db } from "../persistence/prisma.js";
import { TokenUsageRepository } from "./token-usage-repository.js";

describe("TokenUsageRepository.record", () => {
  it("upserts with an atomic increment, not a read-then-write", async () => {
    const upsert = vi.fn(() => Promise.resolve({}));
    const db = { tokenUsage: { upsert } } as unknown as Db;

    await new TokenUsageRepository(db).record("user-1", {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    });

    expect(upsert).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      create: { userId: "user-1", inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      update: {
        inputTokens: { increment: 10 },
        outputTokens: { increment: 20 },
        totalTokens: { increment: 30 },
      },
    });
  });
});

describe("TokenUsageRepository.findByUserId", () => {
  it("returns null rather than a zeroed row for an unknown user", async () => {
    const findUnique = vi.fn(() => Promise.resolve(null));
    const db = { tokenUsage: { findUnique } } as unknown as Db;

    await expect(new TokenUsageRepository(db).findByUserId("nobody")).resolves.toBeNull();
  });
});
