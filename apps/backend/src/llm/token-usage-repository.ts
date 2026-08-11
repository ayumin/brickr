import type { Db } from "../persistence/prisma.js";

export type TokenUsageTotals = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

/**
 * Running per-user LLM token totals (CLAUDE.md §66.4). One row per user,
 * incremented rather than logged — see the schema comment on `TokenUsage`.
 */
export class TokenUsageRepository {
  constructor(private readonly db: Db) {}

  async record(userId: string, usage: TokenUsageTotals): Promise<void> {
    await this.db.tokenUsage.upsert({
      where: { userId },
      create: { userId, ...usage },
      update: {
        inputTokens: { increment: usage.inputTokens },
        outputTokens: { increment: usage.outputTokens },
        totalTokens: { increment: usage.totalTokens },
      },
    });
  }

  async findByUserId(userId: string): Promise<TokenUsageTotals | null> {
    const row = await this.db.tokenUsage.findUnique({
      where: { userId },
      select: { inputTokens: true, outputTokens: true, totalTokens: true },
    });
    return row ?? null;
  }
}
