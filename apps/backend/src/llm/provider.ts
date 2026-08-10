/**
 * LLM provider abstraction.
 *
 * Provider-specific request shapes, SDK types and error formats must not leak
 * past this module. Everything above the `llm/` directory sees only these
 * types.
 */

export const PROVIDER_IDS = ["openai", "anthropic", "gemini", "mock"] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export type LLMRole = "user" | "assistant";

export type LLMImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export type LLMImage = {
  mediaType: LLMImageMediaType;
  /** Raw base64 payload without the data-URL prefix. */
  data: string;
};

export type LLMMessage = {
  role: LLMRole;
  content: string;
  /** Images referred to by this message, in the same order as its labels. */
  images?: LLMImage[];
};

export type LLMStructuredOutput = {
  /** Provider-safe schema name: letters, numbers, underscores and dashes. */
  name: string;
  schema: Record<string, unknown>;
};

export type LLMGenerateRequest = {
  model: string;
  systemPrompt: string;
  messages: LLMMessage[];
  /** Upper bound on generated tokens. Posts are short, so this stays small. */
  maxOutputTokens?: number;
  /** Ignored by providers that no longer accept a sampling temperature. */
  temperature?: number;
  /** JSON Schema enforced by providers that support structured output. */
  structuredOutput?: LLMStructuredOutput;
  /** Abort signal used to enforce the per-call timeout. */
  signal?: AbortSignal;
};

export type LLMGenerateResult = {
  text: string;
  /** Echo of what actually served the request, for logging. */
  model: string;
  providerId: ProviderId;
};

export interface LLMProvider {
  readonly id: ProviderId;
  /** False when the provider has no credentials configured. */
  readonly available: boolean;
  /**
   * Model to use when this provider stands in for an unconfigured one.
   * A model name is only meaningful to the provider that serves it, so a
   * fallback has to substitute the model along with the provider.
   */
  readonly defaultModel: string;
  generate(request: LLMGenerateRequest): Promise<LLMGenerateResult>;
}

/**
 * Raised for any provider failure. Simulation treats these as expected
 * failures: one character drops out, the rest keep going.
 */
export class LLMError extends Error {
  constructor(
    message: string,
    readonly providerId: ProviderId,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "LLMError";
  }
}

export class LLMTimeoutError extends LLMError {
  constructor(providerId: ProviderId, timeoutMs: number) {
    super(`${providerId} timed out after ${timeoutMs}ms`, providerId, true);
    this.name = "LLMTimeoutError";
  }
}
