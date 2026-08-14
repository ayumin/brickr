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
import { requireClient, toLLMError } from "./provider-http-error.js";
import type {
  LLMAvailableModel,
  LLMGenerateRequest,
  LLMGenerateResult,
  LLMProvider,
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

  async listModels(signal?: AbortSignal): Promise<LLMAvailableModel[]> {
    const client = requireClient(this.client, PROVIDER_ID);

    try {
      const page = await client.models.list(
        { limit: 1_000 },
        signal ? { signal } : undefined,
      );
      const models: LLMAvailableModel[] = [];
      for await (const model of page) {
        models.push({ id: model.id, displayName: model.display_name });
      }
      return models;
    } catch (error) {
      throw toLLMError(PROVIDER_ID, error);
    }
  }

  async generate(request: LLMGenerateRequest): Promise<LLMGenerateResult> {
    const client = requireClient(this.client, PROVIDER_ID);

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
          ...(request.structuredOutput
            ? {
                output_config: {
                  format: {
                    type: "json_schema" as const,
                    schema: request.structuredOutput.schema,
                  },
                },
              }
            : {}),
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
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          totalTokens: message.usage.input_tokens + message.usage.output_tokens,
        },
      };
    } catch (error) {
      throw toLLMError(PROVIDER_ID, error);
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

