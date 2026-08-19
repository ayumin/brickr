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
const GEMINI_PROVIDER_ID: ProviderId = "gemini";

/**
 * Fixed fallback chain: Primary → Gemini → Mock.
 *
 * Gemini is always the secondary provider; Mock is the last resort so the
 * application never stops responding even when all real providers are down.
 */
const RUNTIME_FALLBACK_SUFFIX: readonly ProviderId[] = [GEMINI_PROVIDER_ID, MOCK_PROVIDER_ID];

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

  async generate(
    providerId: ProviderId,
    requested: LLMGenerateRequest,
  ): Promise<LLMGenerateResult> {
    // Build the ordered list of providers to try: Primary → Gemini → Mock.
    // Deduplicate so that e.g. "gemini" as primary does not appear twice.
    const chain = buildFallbackChain(providerId);

    let lastError: LLMError | undefined;

    for (const currentId of chain) {
      // Skip providers that are not registered / have no credentials.
      if (!this.registry.has(currentId)) {
        continue;
      }

      const provider = this.registry.get(currentId);

      // Adapt the model when switching providers: a model name is only
      // meaningful to the provider that serves it.
      const request: LLMGenerateRequest =
        currentId === providerId
          ? requested
          : {
              ...requested,
              model: this.fallbackModel?.(currentId) ?? provider.defaultModel,
            };

      // Budget circuit-breaker check (issue #162). The mock provider is exempt
      // so tests and development environments are never blocked by budget state.
      if (this.budgetChecker && currentId !== MOCK_PROVIDER_ID) {
        let allowed: boolean;
        try {
          allowed = await this.budgetChecker.isAllowed(currentId);
        } catch (error) {
          const normalized = normalizeError(error, currentId);
          lastError = normalized;
          // Budget checker failure is treated as a transient error; try next provider.
          this.logFallback(providerId, currentId, normalized.message, "retrying_next");
          continue;
        }
        if (!allowed) {
          // Budget exceeded is provider-specific and non-retryable; skip to next.
          const budgetError = new LLMBudgetExceededError(currentId);
          lastError = budgetError;
          this.logFallback(providerId, currentId, "budget_exceeded", "retrying_next");
          continue;
        }
      }

      try {
        const result = await this.callWithRetry(provider, request);
        this.usageTracker?.record(result);

        // Log success when a fallback was used.
        if (currentId !== providerId) {
          this.logFallback(providerId, currentId, lastError?.message ?? "unknown", "success");
        }

        return result;
      } catch (error) {
        const normalized = normalizeError(error, currentId);
        lastError = normalized;

        // Abort errors (user-cancelled requests) must not trigger fallback —
        // the caller explicitly cancelled the operation.
        // `callWithRetry` wraps the original error in an LLMError, so we
        // inspect both the thrown value and its cause.
        if (isAbortError(error) || isAbortError((error as LLMError)?.cause)) {
          throw normalized;
        }

        // Log that we are moving to the next provider.
        this.logFallback(providerId, currentId, normalized.message, "retrying_next");
      }
    }

    // All providers in the chain have been exhausted.
    this.logFallback(
      providerId,
      "none",
      lastError?.message ?? "unknown",
      "failed",
    );
    throw lastError ?? new LLMError("all providers failed", providerId, false);
  }

  /**
   * Attempts the call up to `maxRetries + 1` times against the same provider
   * before giving up and letting the caller try the next provider in the chain.
   */
  private async callWithRetry(
    provider: LLMProvider,
    request: LLMGenerateRequest,
  ): Promise<LLMGenerateResult> {
    const attempts = Math.max(0, this.options.maxRetries) + 1;
    let lastError: LLMError | undefined;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.callOnce(provider, request);
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
   * Logs a fallback event in the structured format required by the spec (§9).
   *
   * Format:
   *   primary=<id> fallback=<id|none> reason=<msg> result=<outcome>
   */
  private logFallback(
    primary: ProviderId,
    fallback: ProviderId | "none",
    reason: string,
    result: "success" | "retrying_next" | "failed",
  ): void {
    this.logger?.debug(
      `primary=${primary} fallback=${fallback} reason=${reason} result=${result}`,
    );
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

/**
 * Builds the ordered fallback chain for a given primary provider.
 *
 * Always: Primary → Gemini → Mock.
 * Deduplicates so that e.g. "gemini" as primary yields ["gemini", "mock"].
 */
function buildFallbackChain(primaryId: ProviderId): ProviderId[] {
  const chain: ProviderId[] = [primaryId];
  for (const id of RUNTIME_FALLBACK_SUFFIX) {
    if (!chain.includes(id)) {
      chain.push(id);
    }
  }
  return chain;
}

/** Returns true when the value is an AbortError (user-cancelled request). */
function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === "AbortError";
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
