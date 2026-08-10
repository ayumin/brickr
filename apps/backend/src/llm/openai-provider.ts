/**
 * OpenAI provider (Chat Completions).
 *
 * SDK types and errors stay inside this file; callers only ever see the
 * abstractions from `provider.ts`.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { env } from "../config/env.js";
import {
  LLMError,
  type LLMAvailableModel,
  type LLMGenerateRequest,
  type LLMGenerateResult,
  type LLMProvider,
} from "./provider.js";

const PROVIDER_ID = "openai" as const;

type OpenAIProviderOptions = {
  apiKey?: string;
  defaultModel?: string;
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

  async listModels(signal?: AbortSignal): Promise<LLMAvailableModel[]> {
    const client = this.client;
    if (!client) {
      throw new LLMError("openai is not configured (missing API key)", PROVIDER_ID, false);
    }

    try {
      const page = await client.models.list(signal ? { signal } : undefined);
      const models: LLMAvailableModel[] = [];
      for await (const model of page) {
        if (isOpenAICharacterModel(model.id)) {
          models.push({ id: model.id, displayName: model.id });
        }
      }
      return models.sort((a, b) => a.id.localeCompare(b.id));
    } catch (error) {
      throw toLLMError(error);
    }
  }

  async generate(request: LLMGenerateRequest): Promise<LLMGenerateResult> {
    const client = this.client;
    if (!client) {
      throw new LLMError("openai is not configured (missing API key)", PROVIDER_ID, false);
    }

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: request.systemPrompt },
      ...request.messages.map(toOpenAIMessage),
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
          ...(request.structuredOutput
            ? {
                response_format: {
                  type: "json_schema" as const,
                  json_schema: {
                    name: request.structuredOutput.name,
                    strict: true,
                    schema: request.structuredOutput.schema,
                  },
                },
              }
            : {}),
        },
        request.signal ? { signal: request.signal } : undefined,
      );

      const choice = completion.choices[0];
      const text = choice?.message.content ?? "";

      return {
        text,
        model: completion.model,
        providerId: PROVIDER_ID,
        ...(completion.usage
          ? {
              usage: {
                inputTokens: completion.usage.prompt_tokens,
                outputTokens: completion.usage.completion_tokens,
                totalTokens: completion.usage.total_tokens,
              },
            }
          : {}),
      };
    } catch (error) {
      throw toLLMError(error);
    }
  }
}

/**
 * OpenAI's Models API reports account availability but not endpoint
 * capabilities. Keep conversational model families and exclude variants for
 * audio, image, search, realtime, transcription, and specialist endpoints.
 */
export function isOpenAICharacterModel(id: string): boolean {
  const normalized = id.toLowerCase();
  const base = normalized.startsWith("ft:") ? normalized.slice(3) : normalized;
  if (!/^(?:gpt-|chatgpt-|o\d+(?:-|$))/u.test(base)) return false;
  return !/(?:audio|realtime|transcri|tts|image|search|moderation|deep-research|computer-use|codex)/u.test(
    base,
  );
}

export function toOpenAIMessage(
  message: LLMGenerateRequest["messages"][number],
): ChatCompletionMessageParam {
  if (message.role === "assistant") {
    return { role: "assistant", content: message.content };
  }
  if (!message.images || message.images.length === 0) {
    return { role: "user", content: message.content };
  }
  return {
    role: "user",
    content: [
      { type: "text", text: message.content },
      ...message.images.map((image) => ({
        type: "image_url" as const,
        image_url: { url: `data:${image.mediaType};base64,${image.data}` },
      })),
    ],
  };
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
