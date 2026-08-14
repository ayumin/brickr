/**
 * Shared error-normalization for provider SDKs.
 *
 * Each provider's error shape differs only in which field carries the HTTP
 * status (Gemini's GenAI SDK exposes it as `status` or `code` depending on the
 * path; OpenAI and Anthropic always use `status`), and in the message prefix
 * naming the provider. Everything else — the retry rule, message extraction,
 * the "missing API key" guard — is identical across all three, so it lives
 * here once instead of three times.
 */

import { LLMError, type ProviderId } from "./provider.js";

/** Reads the first numeric value found among `fields` on `error`. */
export function httpStatusOf(
  error: unknown,
  fields: readonly string[] = ["status"],
): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as Record<string, unknown>;
  for (const field of fields) {
    const value = candidate[field];
    if (typeof value === "number") return value;
  }
  return undefined;
}

/** 429 / 5xx / transport failures are worth one more shot; 4xx are not. */
export function isRetryableStatus(status: number | undefined, error: unknown): boolean {
  if (status === undefined) {
    return !(error instanceof Error && error.name === "AbortError");
  }
  if (status === 408 || status === 409 || status === 429) return true;
  // Anthropic's 529 (overloaded) also lands here.
  return status >= 500;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Normalizes any thrown value into an `LLMError`, passing an existing one
 * through unchanged so a caller's `retryable` decision is never overwritten.
 *
 * `statusFields` lets a provider whose SDK reports the status under a
 * different (or additional) field name — currently only Gemini — opt into
 * checking it, without every provider needing to know about the others' SDKs.
 */
export function toLLMError(
  providerId: ProviderId,
  error: unknown,
  statusFields?: readonly string[],
): LLMError {
  if (error instanceof LLMError) return error;

  const status = httpStatusOf(error, statusFields);
  return new LLMError(
    `${providerId} request failed${status === undefined ? "" : ` (status ${status})`}: ${messageOf(error)}`,
    providerId,
    isRetryableStatus(status, error),
    { cause: error },
  );
}

/** Throws the shared "not configured" `LLMError` when `client` is absent. */
export function requireClient<T>(client: T | undefined, providerId: ProviderId): T {
  if (!client) {
    throw new LLMError(`${providerId} is not configured (missing API key)`, providerId, false);
  }
  return client;
}
