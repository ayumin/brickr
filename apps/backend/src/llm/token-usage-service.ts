import type { UserTokenUsageResponse } from "@brickr/shared";
import type { TokenUsageRepository, TokenUsageTotals } from "./token-usage-repository.js";

const ZERO_USAGE: TokenUsageTotals = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

/**
 * Records and reads per-user LLM token usage (CLAUDE.md §66.4). Backs both the
 * admin drilldown (`GET /api/users/:id/token-usage`) and the self-service view
 * (`GET /api/user-profile/token-usage`) — same totals, different guard.
 */
export class TokenUsageService {
  constructor(private readonly tokenUsage: TokenUsageRepository) {}

  async record(userId: string, usage: TokenUsageTotals): Promise<void> {
    await this.tokenUsage.record(userId, usage);
  }

  /** Zeroed, not 404, for a user who has never triggered a generation. */
  async getDto(userId: string): Promise<UserTokenUsageResponse> {
    const totals = (await this.tokenUsage.findByUserId(userId)) ?? ZERO_USAGE;
    return {
      totalInputTokens: totals.inputTokens,
      totalOutputTokens: totals.outputTokens,
      totalTokens: totals.totalTokens,
    };
  }
}
