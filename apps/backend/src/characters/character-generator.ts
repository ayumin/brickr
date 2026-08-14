import { z } from "zod";
import type { LLMClient } from "../llm/llm-client.js";
import type { ModelProfile } from "../model-profiles/model-profile.js";
import { runWithConcurrency } from "../simulation/concurrency.js";

const BATCH_SIZE = 5;
const MAX_CONCURRENT_BATCHES = 3;
const PARSE_ATTEMPTS = 2;

const generatedPersonaSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  rolePrompt: z.string().trim().min(1).max(4_000),
  tonePrompt: z.string().trim().min(1).max(4_000),
  dialectPrompt: z.string().trim().max(2_000).nullable().optional(),
  interests: z.array(z.string().trim().min(1).max(80)).max(20),
});

export type GeneratedCharacterPersona = z.infer<typeof generatedPersonaSchema>;

export class CharacterPersonaParseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CharacterPersonaParseError";
  }
}

export interface CharacterPersonaGenerator {
  generate(
    count: number,
    profile: ModelProfile,
    onProgress?: (completed: number) => void,
  ): Promise<GeneratedCharacterPersona[]>;
}

export class LLMCharacterPersonaGenerator implements CharacterPersonaGenerator {
  constructor(private readonly llm: LLMClient) {}

  async generate(
    count: number,
    profile: ModelProfile,
    onProgress?: (completed: number) => void,
  ): Promise<GeneratedCharacterPersona[]> {
    const batchSizes: number[] = [];
    for (let remaining = count; remaining > 0; remaining -= BATCH_SIZE) {
      batchSizes.push(Math.min(BATCH_SIZE, remaining));
    }

    let completed = 0;
    const results = await runWithConcurrency(
      batchSizes,
      MAX_CONCURRENT_BATCHES,
      async (size, index) => {
        const generated = await this.generateBatch(size, index, profile);
        completed += generated.length;
        onProgress?.(Math.min(count, completed));
        return generated;
      },
    );
    const generated: GeneratedCharacterPersona[] = [];
    for (const result of results) {
      if ("error" in result) throw result.error;
      generated.push(...result.value);
    }
    if (generated.length !== count) {
      throw new CharacterPersonaParseError(
        `LLMが要求数を生成できませんでした（${String(generated.length)} / ${String(count)}人）。`,
      );
    }
    return generated;
  }

  private async generateBatch(
    count: number,
    batchIndex: number,
    profile: ModelProfile,
  ): Promise<GeneratedCharacterPersona[]> {
    let lastError: unknown;
    for (let attempt = 0; attempt < PARSE_ATTEMPTS; attempt += 1) {
      const result = await this.llm.generate(profile.providerId, {
        model: profile.model,
        systemPrompt: CHARACTER_GENERATION_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              `count: ${String(count)}`,
              `batch: ${String(batchIndex + 1)}`,
              "互いに異なる人物像をJSON配列で生成してください。",
            ].join("\n"),
          },
        ],
        maxOutputTokens: 4_000,
        temperature: 1,
        structuredOutput: {
          name: "character_batch",
          schema: characterGenerationJsonSchema(count),
        },
      });
      try {
        return parseGeneratedPersonas(result.text, count);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error("LLM character generation failed");
  }
}

const CHARACTER_GENERATION_SYSTEM_PROMPT = `
SNSシミュレーション用の架空の日本語キャラクターを設計してください。
全員の立場、価値観、職業、年代、話し方、関心を明確に変えてください。
実在人物や既存作品のキャラクターは作らないでください。

charactersキーを持つJSONオブジェクトだけを返してください。Markdownや説明文は禁止です。
charactersはcharacter_1からcharacter_Nまでのキーを持つオブジェクトです。
Nは要求されたcountと完全に一致させ、各character_Nは次のキーを持たせてください。
- displayName: 80文字以内の表示名
- description: 公開プロフィール。60〜120文字程度
- rolePrompt: 判断基準、性格、立場を具体的に記述。80〜180文字程度
- tonePrompt: 口調、文体、発言の癖。40〜100文字程度
- dialectPrompt: 方言指定。なければ空文字列
- interests: 1〜5個の短い関心分野の配列
`;

export function parseGeneratedPersonas(
  text: string,
  expectedCount: number,
): GeneratedCharacterPersona[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new CharacterPersonaParseError(
      "LLMの応答にキャラクターオブジェクトが含まれていませんでした。",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (cause) {
    throw new CharacterPersonaParseError(
      "LLMの応答をJSONとして解析できませんでした。",
      { cause },
    );
  }
  const validated = z
    .object({ characters: z.record(z.string(), generatedPersonaSchema) })
    .safeParse(parsed);
  if (!validated.success) {
    const actualCount =
      typeof parsed === "object" &&
      parsed !== null &&
      "characters" in parsed &&
      typeof parsed.characters === "object" &&
      parsed.characters !== null &&
      !Array.isArray(parsed.characters)
        ? Object.keys(parsed.characters).length
        : null;
    const countDetail =
      actualCount === null || actualCount === expectedCount
        ? ""
        : `（${String(actualCount)} / ${String(expectedCount)}人）`;
    throw new CharacterPersonaParseError(
      `LLMの応答が必要な項目または件数を満たしていませんでした${countDetail}。`,
      { cause: validated.error },
    );
  }
  const expectedKeys = characterKeys(expectedCount);
  const actualCount = Object.keys(validated.data.characters).length;
  if (actualCount !== expectedCount) {
    throw new CharacterPersonaParseError(
      `LLMが要求数を生成できませんでした（${String(actualCount)} / ${String(expectedCount)}人）。`,
    );
  }
  const generated = expectedKeys.map((key) => validated.data.characters[key]);
  if (generated.some((persona) => persona === undefined)) {
    throw new CharacterPersonaParseError(
      "LLMの応答に要求されたキャラクターキーが含まれていませんでした。",
    );
  }
  return generated as GeneratedCharacterPersona[];
}

export function characterGenerationJsonSchema(count: number): Record<string, unknown> {
  const keys = characterKeys(count);
  const characterSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      displayName: { type: "string" },
      description: { type: "string" },
      rolePrompt: { type: "string" },
      tonePrompt: { type: "string" },
      dialectPrompt: { type: "string" },
      interests: {
        type: "array",
        minItems: 1,
        items: { type: "string" },
      },
    },
    required: [
      "displayName",
      "description",
      "rolePrompt",
      "tonePrompt",
      "dialectPrompt",
      "interests",
    ],
  };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      characters: {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(keys.map((key) => [key, characterSchema])),
        required: keys,
      },
    },
    required: ["characters"],
  };
}

function characterKeys(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `character_${String(index + 1)}`);
}
