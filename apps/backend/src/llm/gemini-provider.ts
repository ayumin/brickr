/**
 * Gemini provider (Google GenAI SDK).
 *
 * SDK types and errors stay inside this file; callers only ever see the
 * abstractions from `provider.ts`.
 */

import { GoogleGenAI } from "@google/genai";
import { env } from "../config/env.js";
import {
  LLMError,
  type LLMGenerateRequest,
  type LLMGenerateResult,
  type LLMProvider,
} from "./provider.js";

const PROVIDER_ID = "gemini" as const;

type GeminiProviderOptions = {
  apiKey?: string;
  defaultModel?: string;
};

/** Gemini calls the assistant role "model". */
type GeminiContent = {
  role: "user" | "model";
  parts: [{ text: string }];
};

export class GeminiProvider implements LLMProvider {
  readonly id = PROVIDER_ID;

  readonly defaultModel: string;

  private readonly client: GoogleGenAI | undefined;

  constructor(options: GeminiProviderOptions) {
    this.defaultModel = options.defaultModel ?? env.gemini.model;
    this.client = options.apiKey ? new GoogleGenAI({ apiKey: options.apiKey }) : undefined;
  }

  get available(): boolean {
    return this.client !== undefined;
  }

  async generate(request: LLMGenerateRequest): Promise<LLMGenerateResult> {
    const client = this.client;
    if (!client) {
      throw new LLMError("gemini is not configured (missing API key)", PROVIDER_ID, false);
    }

    const contents: GeminiContent[] = request.messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));

    try {
      const response = await client.models.generateContent({
        model: request.model,
        contents,
        config: {
          systemInstruction: request.systemPrompt,
          ...(request.maxOutputTokens === undefined
            ? {}
            : { maxOutputTokens: request.maxOutputTokens }),
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          ...(request.signal ? { abortSignal: request.signal } : {}),
        },
      });

      return {
        text: response.text ?? "",
        model: request.model,
        providerId: PROVIDER_ID,
      };
    } catch (error) {
      throw toLLMError(error);
    }
  }
}

function toLLMError(error: unknown): LLMError {
  if (error instanceof LLMError) return error;

  const status = httpStatusOf(error);
  return new LLMError(
    `gemini request failed${status === undefined ? "" : ` (status ${status})`}: ${messageOf(error)}`,
    PROVIDER_ID,
    isRetryable(status, error),
    { cause: error },
  );
}

/** The GenAI SDK exposes the HTTP status as `status` or `code` depending on the path. */
function httpStatusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as { status?: unknown; code?: unknown };
  if (typeof candidate.status === "number") return candidate.status;
  if (typeof candidate.code === "number") return candidate.code;
  return undefined;
}

function isRetryable(status: number | undefined, error: unknown): boolean {
  if (status === undefined) {
    return !(error instanceof Error && error.name === "AbortError");
  }
  if (status === 408 || status === 409 || status === 429) return true;
  return status >= 500;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
