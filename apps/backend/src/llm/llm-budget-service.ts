import { DomainError } from "../domain-error.js";
import type { LLMBudgetRepository, BudgetRow } from "./llm-budget-repository.js";
import type { ProviderId } from "./provider.js";

export type ProviderBudgetDto = {
  provider: string;
  tokenLimit: number;
  totalTokens: number;
  stopped: boolean;
};

export type LLMBudgetDto = {
  providers: ProviderBudgetDto[];
};

export type SetBudgetLimitInput = {
  provider: ProviderId;
  tokenLimit: number;
};

/**
 * Circuit-breaker service for per-provider LLM token budgets (issue #162).
 *
 * Responsibilities:
 *  - Check whether a provider is stopped before a generation call.
 *  - Record token usage after a successful generation and stop the provider
 *    when the configured limit is exceeded.
 *  - Expose the current budget state for the admin dashboard.
 *  - Allow an administrator to reset a stopped provider.
 *
 * The "stopped" flag is sticky: once set it remains true until an admin
 * explicitly calls `reset`. Deleting rooms removes per-room usage rows but
 * does not affect the global aggregate or the stopped flag.
 */
export class LLMBudgetService {
  constructor(private readonly repository: LLMBudgetRepository) {}

  /**
   * Returns true when the provider may be called, false when the circuit
   * breaker is open (budget exceeded or admin-stopped).
   *
   * A provider with no budget row (no limit configured) is always allowed.
   */
  async isAllowed(provider: ProviderId): Promise<boolean> {
    const stopped = await this.repository.isStopped(provider);
    return !stopped;
  }

  /**
   * Records token usage for a completed generation and stops the provider
   * if the new total meets or exceeds the configured limit.
   *
   * Both the per-room log (`llm_usages`) and the global aggregate
   * (`llm_budgets.total_tokens`) are updated atomically.
   *
   * @param provider  The provider that served the request.
   * @param tokens    Total tokens consumed (input + output).
   * @param roomId    The room the generation was triggered from, or null.
   */
  async recordUsage(
    provider: ProviderId,
    tokens: number,
    roomId: string | null,
  ): Promise<void> {
    // Write the per-room log entry first (cascade-deletable with the room).
    await this.repository.recordUsage(provider, tokens, roomId);
    // Then atomically increment the global aggregate and check the limit.
    await this.repository.incrementAndCheckLimit(provider, tokens);
  }

  /**
   * Returns the current budget state for all configured providers.
   * Providers that have never had a budget row are omitted.
   */
  async getAll(): Promise<LLMBudgetDto> {
    const rows = await this.repository.findAll();
    return { providers: rows.map(toDto) };
  }

  /**
   * Sets the token limit for a provider.
   * A limit of 0 means "no limit" (the circuit breaker will never trip on
   * token count alone, but the stopped flag can still be set manually).
   */
  async setLimit(input: SetBudgetLimitInput): Promise<ProviderBudgetDto> {
    if (input.tokenLimit < 0) {
      throw new InvalidBudgetError("tokenLimit must be >= 0");
    }
    await this.repository.setLimit(input.provider, input.tokenLimit);
    const row = await this.repository.findByProvider(input.provider);
    // setLimit upserts, so the row always exists after the call.
    return toDto(row!);
  }

  /**
   * Resets the circuit breaker for a provider: clears the stopped flag and
   * zeroes the global token aggregate. Only administrators may call this.
   */
  async reset(provider: ProviderId): Promise<ProviderBudgetDto> {
    const row = await this.repository.reset(provider);
    return toDto(row);
  }
}

function toDto(row: BudgetRow): ProviderBudgetDto {
  return {
    provider: row.provider,
    tokenLimit: row.tokenLimit,
    totalTokens: row.totalTokens,
    stopped: row.stopped,
  };
}

export class InvalidBudgetError extends DomainError {
  readonly httpStatus = 400;
  readonly errorCode = "invalid_budget" as const;
}

export class ProviderNotFoundError extends DomainError {
  readonly httpStatus = 404;
  readonly errorCode = "not_found" as const;
  constructor(provider: string) {
    super(`provider "${provider}" not found`);
  }
}
