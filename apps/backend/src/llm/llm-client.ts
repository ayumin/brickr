/**
 * The single entry point into the LLM layer.
 *
 * Owns timeout, bounded retry, provider fallback and error normalization, so
 * the room runtime only ever has to deal with `LLMError`.
 */

import type { LLMProviderRegistry } from "./provider-registry.js";
import type { LLMUsageTracker } from "./usage-tracker.js";
import {
  LLMError,
  LLMTimeoutError,
  type LLMGenerateRequest,
  type LLMGenerateResult,
  type LLMProvider,
  type ProviderId,
} from "./provider.js";

const MOCK_PROVIDER_ID: ProviderId = "mock";

export type LLMClientOptions = {
  timeoutMs: number;
  maxRetries: number;
};

export type LLMClientLogger = {
  debug: (msg: string) => void;
};

/**
 * Narrow interface for the budget circuit-breaker (issue #162).
 *
 * Declared here rather than importing `LLMBudgetService` directly so the LLM
 * layer does not depend on the budget persistence layer — the concrete service
 * is injected from the composition root.
 */
export type LLMBudgetChecker = {
  isAllowed(provider: ProviderId): Promise<boolean>;
  recordUsage(provider: ProviderId, tokens: number, roomId: string | null): Promise<void>;
};

export class LLMClient {
  private readonly loggedFallbacks = new Set<ProviderId>();

  constructor(
    private readonly registry: LLMProviderRegistry,
    private readonly options: LLMClientOptions,
    private readonly logger?: LLMClientLogger,
    private readonly usageTracker?: LLMUsageTracker,
    private readonly fallbackModel?: (providerId: ProviderId) => string | undefined,
    private readonly budgetChecker?: LLMBudgetChecker,
  ) {}

  async generate(
    providerId: ProviderId,
    requested: LLMGenerateRequest,
  ): Promise<LLMGenerateResult> {
    const provider = this.resolveProvider(providerId);
    // A model name only means something to the provider that serves it, so a
    // substituted provider must bring its own model.
    const request: LLMGenerateRequest =
      provider.id === providerId
        ? requested
        : {
            ...requested,
            model: this.fallbackModel?.(provider.id) ?? provider.defaultModel,
          };

    // Budget circuit-breaker check (issue #162). The mock provider is exempt
    // so tests and development environments are never blocked by budget state.
    if (this.budgetChecker && provider.id !== MOCK_PROVIDER_ID) {
      let allowed: boolean;
      try {
        allowed = await this.budgetChecker.isAllowed(provider.id);
      } catch (error) {
        throw normalizeError(error, provider.id);
      }
      if (!allowed) {
        throw new LLMBudgetExceededError(provider.id);
      }
    }

    const attempts = Math.max(0, this.options.maxRetries) + 1;

    let lastError: LLMError | undefined;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const result = await this.callOnce(provider, request);
        this.usageTracker?.record(result);
        return result;
      } catch (error) {
        const normalized = normalizeError(error, provider.id);
        lastError = normalized;

        const isLastAttempt = attempt === attempts;
        if (!normalized.retryable || isLastAttempt) {
          throw normalized;
        }

        this.logger?.debug(
          `llm retry ${attempt}/${attempts - 1} for ${provider.id}: ${normalized.message}`,
        );
      }
    }

    // Unreachable: the loop either returns or throws.
    throw lastError ?? new LLMError("llm generation failed", provider.id, false);
  }

  /**
   * A missing API key degrades instead of breaking the room.
   *
   * Prefers another *real* provider so characters still produce genuine text
   * when only some keys are configured, and only uses the mock when nothing
   * real is available. The choice is deterministic per requested provider, so a
   * character keeps the same substitute for the whole run.
   *
   * Logged once per provider so it does not spam the log.
   */
  private resolveProvider(providerId: ProviderId): LLMProvider {
    if (this.registry.has(providerId)) {
      return this.registry.get(providerId);
    }

    const substituteId =
      this.registry.availableIds().find((id) => id !== MOCK_PROVIDER_ID) ?? MOCK_PROVIDER_ID;

    if (!this.loggedFallbacks.has(providerId)) {
      this.loggedFallbacks.add(providerId);
      this.logger?.debug(
        `provider "${providerId}" unavailable; falling back to "${substituteId}"`,
      );
    }

    return this.registry.get(substituteId);
  }

  private async callOnce(
    provider: LLMProvider,
    request: LLMGenerateRequest,
  ): Promise<LLMGenerateResult> {
    const { timeoutMs } = this.options;
    const controller = new AbortController();

    let timer: ReturnType<typeof setTimeout> | undefined;
    let onExternalAbort: (() => void) | undefined;
    const externalSignal = request.signal;

    try {
      if (externalSignal) {
        if (externalSignal.aborted) {
          controller.abort();
        } else {
          onExternalAbort = () => controller.abort();
          externalSignal.addEventListener("abort", onExternalAbort);
        }
      }

      // Providers that honour the signal stop early; the race guarantees the
      // timeout fires even for those that do not.
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new LLMTimeoutError(provider.id, timeoutMs));
        }, timeoutMs);
      });

      const result = await Promise.race([
        provider.generate({ ...request, signal: controller.signal }),
        timeout,
      ]);

      if (result.text.trim().length === 0) {
        throw new LLMError(`${provider.id} returned an empty response`, provider.id, true);
      }

      return result;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (externalSignal && onExternalAbort) {
        externalSignal.removeEventListener("abort", onExternalAbort);
      }
    }
  }
}

/** Never let an SDK-specific error type escape the LLM layer. */
function normalizeError(error: unknown, providerId: ProviderId): LLMError {
  if (error instanceof LLMError) return error;

  const message = error instanceof Error ? error.message : String(error);
  // A cancelled request is not worth retrying; anything else might be transient.
  const retryable = !(error instanceof Error && error.name === "AbortError");

  return new LLMError(`${providerId} request failed: ${message}`, providerId, retryable, {
    cause: error,
  });
}

/**
 * Raised when the budget circuit breaker is open for a provider (issue #162).
 *
 * Not retryable: the breaker stays open until an administrator resets it.
 * Treated as an expected failure by the room runtime (same as `LLMError`),
 * so one character dropping out does not stop the rest.
 */
export class LLMBudgetExceededError extends LLMError {
  constructor(providerId: ProviderId) {
    super(
      `LLM budget exceeded for provider "${providerId}"; all generation is stopped until an administrator resets the budget`,
      providerId,
      false, // not retryable — admin action required
    );
    this.name = "LLMBudgetExceededError";
  }
}
