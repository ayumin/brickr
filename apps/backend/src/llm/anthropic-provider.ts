/**
 * Anthropic provider (Messages API).
 *
 * SDK types and errors stay inside this file; callers only ever see the
 * abstractions from `provider.ts`.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  MessageParam,
} from "@anthropic-ai/sdk/resources/messages/messages";
import { env } from "../config/env.js";
import {
  LLMError,
  type LLMGenerateRequest,
  type LLMGenerateResult,
  type LLMProvider,
} from "./provider.js";

const PROVIDER_ID = "anthropic" as const;

/** SNS posts are short; this only needs to be a safety ceiling. */
const DEFAULT_MAX_TOKENS = 512;

type AnthropicProviderOptions = {
  apiKey?: string;
  defaultModel?: string;
};

export class AnthropicProvider implements LLMProvider {
  readonly id = PROVIDER_ID;

  readonly defaultModel: string;

  private readonly client: Anthropic | undefined;

  constructor(options: AnthropicProviderOptions) {
    this.defaultModel = options.defaultModel ?? env.anthropic.model;
    this.client = options.apiKey ? new Anthropic({ apiKey: options.apiKey }) : undefined;
  }

  get available(): boolean {
    return this.client !== undefined;
  }

  async generate(request: LLMGenerateRequest): Promise<LLMGenerateResult> {
    const client = this.client;
    if (!client) {
      throw new LLMError("anthropic is not configured (missing API key)", PROVIDER_ID, false);
    }

    // `request.temperature` is deliberately ignored: current Claude models
    // (claude-sonnet-5, claude-opus-5, claude-opus-4-7+) reject temperature /
    // top_p / top_k with a 400.

    try {
      const message = await client.messages.create(
        {
          model: request.model,
          // Anthropic still uses `max_tokens` (unlike OpenAI's max_completion_tokens).
          max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
          system: request.systemPrompt,
          messages: request.messages.map(toAnthropicMessage),
          // Thinking is wasted latency for a 100-140 character SNS post.
          thinking: { type: "disabled" },
        },
        request.signal ? { signal: request.signal } : undefined,
      );

      // `content` is a discriminated union: keep the text blocks, drop the rest.
      const text = message.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("");

      return {
        text,
        model: message.model,
        providerId: PROVIDER_ID,
      };
    } catch (error) {
      throw toLLMError(error);
    }
  }
}

export function toAnthropicMessage(
  message: LLMGenerateRequest["messages"][number],
): MessageParam {
  if (!message.images || message.images.length === 0) {
    return { role: message.role, content: message.content };
  }

  const content: ContentBlockParam[] = [
    { type: "text", text: message.content },
    ...message.images.map((image) => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: image.mediaType,
        data: image.data,
      },
    })),
  ];
  return { role: message.role, content };
}

function toLLMError(error: unknown): LLMError {
  if (error instanceof LLMError) return error;

  const status = httpStatusOf(error);
  return new LLMError(
    `anthropic request failed${status === undefined ? "" : ` (status ${status})`}: ${messageOf(error)}`,
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

function isRetryable(status: number | undefined, error: unknown): boolean {
  if (status === undefined) {
    return !(error instanceof Error && error.name === "AbortError");
  }
  if (status === 408 || status === 409 || status === 429) return true;
  // 529 (overloaded) also lands here.
  return status >= 500;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
