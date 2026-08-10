/**
 * OpenAI provider (Chat Completions).
 *
 * SDK types and errors stay inside this file; callers only ever see the
 * abstractions from `provider.ts`.
 */

import OpenAI from "openai";
import { env } from "../config/env.js";
import {
  LLMError,
  type LLMGenerateRequest,
  type LLMGenerateResult,
  type LLMProvider,
} from "./provider.js";

const PROVIDER_ID = "openai" as const;

type OpenAIProviderOptions = {
  apiKey?: string;
  defaultModel?: string;
};

/** OpenAI chat message shape, kept minimal on purpose. */
type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export class OpenAIProvider implements LLMProvider {
  readonly id = PROVIDER_ID;

  readonly defaultModel: string;

  private readonly client: OpenAI | undefined;

  constructor(options: OpenAIProviderOptions) {
    this.defaultModel = options.defaultModel ?? env.openai.model;
    // The SDK throws when constructed without a key, so stay unconstructed.
    this.client = options.apiKey ? new OpenAI({ apiKey: options.apiKey }) : undefined;
  }

  get available(): boolean {
    return this.client !== undefined;
  }

  async generate(request: LLMGenerateRequest): Promise<LLMGenerateResult> {
    const client = this.client;
    if (!client) {
      throw new LLMError("openai is not configured (missing API key)", PROVIDER_ID, false);
    }

    const messages: ChatMessage[] = [
      { role: "system", content: request.systemPrompt },
      ...request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ];

    try {
      const completion = await client.chat.completions.create(
        {
          model: request.model,
          messages,
          // Chat Completions replaced `max_tokens` with `max_completion_tokens`.
          ...(request.maxOutputTokens === undefined
            ? {}
            : { max_completion_tokens: request.maxOutputTokens }),
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        },
        request.signal ? { signal: request.signal } : undefined,
      );

      const choice = completion.choices[0];
      const text = choice?.message.content ?? "";

      return {
        text,
        model: completion.model,
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
    `openai request failed${status === undefined ? "" : ` (status ${status})`}: ${messageOf(error)}`,
    PROVIDER_ID,
    isRetryable(status, error),
    { cause: error },
  );
}

function httpStatusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

/** 429 / 5xx / transport failures are worth one more shot; 4xx are not. */
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
