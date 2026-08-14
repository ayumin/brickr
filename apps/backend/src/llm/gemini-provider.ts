/**
 * Gemini provider (Google GenAI SDK).
 *
 * SDK types and errors stay inside this file; callers only ever see the
 * abstractions from `provider.ts`.
 */

import { GoogleGenAI, type Content, type Part } from "@google/genai";
import { env } from "../config/env.js";
import { requireClient, toLLMError } from "./provider-http-error.js";
import type {
  LLMAvailableModel,
  LLMGenerateRequest,
  LLMGenerateResult,
  LLMProvider,
} from "./provider.js";

const PROVIDER_ID = "gemini" as const;
/** The GenAI SDK exposes the HTTP status as `status` or `code` depending on the path. */
const STATUS_FIELDS = ["status", "code"] as const;

type GeminiProviderOptions = {
  apiKey?: string;
  defaultModel?: string;
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

  async listModels(signal?: AbortSignal): Promise<LLMAvailableModel[]> {
    const client = requireClient(this.client, PROVIDER_ID);

    try {
      const page = await client.models.list({
        config: {
          pageSize: 1_000,
          ...(signal ? { abortSignal: signal } : {}),
        },
      });
      const models: LLMAvailableModel[] = [];
      for await (const model of page) {
        const id = geminiGenerationModelId(model.name, model.supportedActions);
        if (id) {
          models.push({ id, displayName: model.displayName ?? id });
        }
      }
      return models.sort((a, b) => a.id.localeCompare(b.id));
    } catch (error) {
      throw toLLMError(PROVIDER_ID, "gemini", error, STATUS_FIELDS);
    }
  }

  async generate(request: LLMGenerateRequest): Promise<LLMGenerateResult> {
    const client = requireClient(this.client, PROVIDER_ID);

    const contents: Content[] = request.messages.map(toGeminiContent);

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
          ...(request.structuredOutput
            ? {
                responseMimeType: "application/json",
                responseJsonSchema: request.structuredOutput.schema,
              }
            : {}),
          ...(request.signal ? { abortSignal: request.signal } : {}),
        },
      });

      return {
        text: response.text ?? "",
        model: request.model,
        providerId: PROVIDER_ID,
        ...(response.usageMetadata
          ? {
              usage: {
                inputTokens: response.usageMetadata.promptTokenCount ?? 0,
                outputTokens: response.usageMetadata.candidatesTokenCount ?? 0,
                totalTokens: response.usageMetadata.totalTokenCount ?? 0,
              },
            }
          : {}),
      };
    } catch (error) {
      throw toLLMError(PROVIDER_ID, "gemini", error, STATUS_FIELDS);
    }
  }
}

/** Returns the generation request id, or null for embedding/image-only models. */
export function geminiGenerationModelId(
  name: string | undefined,
  supportedActions: readonly string[] | undefined,
): string | null {
  if (!name || !supportedActions?.includes("generateContent")) return null;
  return name.startsWith("models/") ? name.slice("models/".length) : name;
}

/** Gemini calls the assistant role "model". */
export function toGeminiContent(
  message: LLMGenerateRequest["messages"][number],
): Content {
  const parts: Part[] = [
    { text: message.content },
    ...(message.images ?? []).map((image) => ({
      inlineData: { mimeType: image.mediaType, data: image.data },
    })),
  ];
  return { role: message.role === "assistant" ? "model" : "user", parts };
}

