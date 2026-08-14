/**
 * OpenAI provider (Chat Completions).
 *
 * SDK types and errors stay inside this file; callers only ever see the
 * abstractions from `provider.ts`.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { env } from "../config/env.js";
import { requireClient, toLLMError } from "./provider-http-error.js";
import type {
  LLMAvailableModel,
  LLMGenerateRequest,
  LLMGenerateResult,
  LLMProvider,
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
    const client = requireClient(this.client, PROVIDER_ID);

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
      throw toLLMError(PROVIDER_ID, "openai", error);
    }
  }

  async generate(request: LLMGenerateRequest): Promise<LLMGenerateResult> {
    const client = requireClient(this.client, PROVIDER_ID);

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
      throw toLLMError(PROVIDER_ID, "openai", error);
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
