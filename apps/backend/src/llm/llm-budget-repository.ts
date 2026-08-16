import type { Db } from "../persistence/prisma.js";
import type { ProviderId } from "./provider.js";

export type BudgetRow = {
  provider: string;
  tokenLimit: number;
  totalTokens: number;
  stopped: boolean;
};

/**
 * Persistence layer for per-provider LLM token budgets (issue #162).
 *
 * One row per provider in `llm_budgets`. The `llm_usages` table holds the
 * per-room log; deleting a room cascades to those rows but does NOT touch
 * the global aggregate here.
 */
export class LLMBudgetRepository {
  constructor(private readonly db: Db) {}

  /** Returns the budget row for a provider, or null if none has been configured. */
  async findByProvider(provider: string): Promise<BudgetRow | null> {
    return this.db.lLMBudget.findUnique({ where: { provider } });
  }

  /** Returns all budget rows, one per provider that has ever been configured. */
  async findAll(): Promise<BudgetRow[]> {
    return this.db.lLMBudget.findMany({ orderBy: { provider: "asc" } });
  }

  /**
   * Upserts the token limit for a provider.
   * Does not touch `totalTokens` or `stopped`.
   */
  async setLimit(provider: string, tokenLimit: number): Promise<void> {
    await this.db.lLMBudget.upsert({
      where: { provider },
      create: { provider, tokenLimit },
      update: { tokenLimit },
    });
  }

  /**
   * Atomically increments the global token aggregate and marks the provider
   * as stopped when the new total exceeds the configured limit.
   *
   * Uses a raw SQL UPDATE so the check-and-set is a single round-trip with no
   * read-then-write race. Returns the updated row.
   */
  async incrementAndCheckLimit(
    provider: string,
    tokens: number,
  ): Promise<BudgetRow> {
    // Upsert ensures the row exists before the increment.
    await this.db.lLMBudget.upsert({
      where: { provider },
      create: { provider, totalTokens: 0 },
      update: {},
    });

    // Atomic increment + conditional stop in one statement.
    await this.db.$executeRaw`
      UPDATE llm_budgets
      SET
        total_tokens = total_tokens + ${tokens},
        stopped = CASE
          WHEN token_limit > 0 AND (total_tokens + ${tokens}) >= token_limit THEN true
          ELSE stopped
        END,
        updated_at = now()
      WHERE provider = ${provider}
    `;

    const row = await this.db.lLMBudget.findUniqueOrThrow({ where: { provider } });
    return row;
  }

  /**
   * Resets the circuit breaker: clears `stopped` and zeroes `totalTokens`.
   * Called by the admin reset endpoint.
   */
  async reset(provider: string): Promise<BudgetRow> {
    return this.db.lLMBudget.upsert({
      where: { provider },
      create: { provider, totalTokens: 0, stopped: false },
      update: { totalTokens: 0, stopped: false },
    });
  }

  /**
   * Records one generation's token usage for a specific room.
   * This is the per-room log; the global aggregate lives in `llm_budgets`.
   */
  async recordUsage(
    provider: string,
    totalTokens: number,
    roomId: string | null,
  ): Promise<void> {
    await this.db.lLMUsage.create({
      data: { provider, totalTokens, roomId },
    });
  }

  /**
   * Returns the sum of tokens consumed by a specific room for a provider.
   * Used for the per-room drilldown view.
   */
  async sumByRoom(provider: string, roomId: string): Promise<number> {
    const result = await this.db.lLMUsage.aggregate({
      where: { provider, roomId },
      _sum: { totalTokens: true },
    });
    return result._sum.totalTokens ?? 0;
  }

  /**
   * Returns the sum of tokens consumed across all providers for a room.
   * Used when displaying room-level usage.
   */
  async sumAllByRoom(roomId: string): Promise<number> {
    const result = await this.db.lLMUsage.aggregate({
      where: { roomId },
      _sum: { totalTokens: true },
    });
    return result._sum.totalTokens ?? 0;
  }

  /**
   * Checks whether a provider is currently stopped (circuit breaker open).
   * Returns false when no budget row exists (no limit configured = not stopped).
   */
  async isStopped(provider: string): Promise<boolean> {
    const row = await this.db.lLMBudget.findUnique({
      where: { provider },
      select: { stopped: true },
    });
    return row?.stopped ?? false;
  }
}

export type { ProviderId };
