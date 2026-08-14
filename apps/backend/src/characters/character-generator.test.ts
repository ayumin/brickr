import { describe, expect, it } from "vitest";
import type { LLMClient } from "../llm/llm-client.js";
import { MockProvider } from "../llm/mock-provider.js";
import type { LLMGenerateRequest } from "../llm/provider.js";
import type { ModelProfile } from "../model-profiles/model-profile.js";
import {
  LLMCharacterPersonaGenerator,
  characterGenerationJsonSchema,
  parseGeneratedPersonas,
} from "./character-generator.js";

const PROFILE: ModelProfile = {
  id: "test-profile",
  providerId: "mock",
  model: "test-model",
};

function persona(index: number) {
  return {
    displayName: `Character ${String(index)}`,
    description: `Profile ${String(index)}`,
    rolePrompt: `Role ${String(index)}`,
    tonePrompt: `Tone ${String(index)}`,
    dialectPrompt: "",
    interests: ["test"],
  };
}

function personas(count: number) {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `character_${String(index + 1)}`,
      persona(index + 1),
    ]),
  );
}

describe("parseGeneratedPersonas", () => {
  it("extracts and validates a fenced structured response", () => {
    const parsed = parseGeneratedPersonas(
      `\`\`\`json\n${JSON.stringify({ characters: personas(2) })}\n\`\`\``,
      2,
    );
    expect(parsed.map(({ displayName }) => displayName)).toEqual([
      "Character 1",
      "Character 2",
    ]);
  });

  it("rejects a response with the wrong number of characters", () => {
    expect(() =>
      parseGeneratedPersonas(JSON.stringify({ characters: personas(1) }), 2),
    ).toThrow("1 / 2人");
  });

  it("reports malformed JSON as the failure reason", () => {
    expect(() => parseGeneratedPersonas('{"characters":[{invalid}]}', 1)).toThrow(
      "JSONとして解析できませんでした",
    );
  });
});

describe("LLMCharacterPersonaGenerator", () => {
  it("splits a larger request into validated batches", async () => {
    let calls = 0;
    const progress: number[] = [];
    const schemas: Array<Record<string, unknown>> = [];
    const llm = {
      generate: (_providerId: string, request: LLMGenerateRequest) => {
        calls += 1;
        if (request.structuredOutput) schemas.push(request.structuredOutput.schema);
        const count = Number(/count:\s*(\d+)/u.exec(request.messages[0]?.content ?? "")?.[1]);
        return Promise.resolve({
          text: JSON.stringify({
            characters: personas(count),
          }),
          providerId: "mock",
          model: "test-model",
        });
      },
    } as unknown as LLMClient;

    const generated = await new LLMCharacterPersonaGenerator(llm).generate(
      7,
      PROFILE,
      (completed) => progress.push(completed),
    );

    expect(generated).toHaveLength(7);
    expect(calls).toBe(2);
    expect(progress.at(-1)).toBe(7);
    expect(schemas).toHaveLength(2);
    expect(schemas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({
            characters: expect.objectContaining({
              required: [
                "character_1",
                "character_2",
                "character_3",
                "character_4",
                "character_5",
              ],
            }),
          }),
        }),
        expect.objectContaining({
          properties: expect.objectContaining({
            characters: expect.objectContaining({
              required: ["character_1", "character_2"],
            }),
          }),
        }),
      ]),
    );
  });
});

describe("LLMCharacterPersonaGenerator against the real MockProvider (USE_MOCK_LLM regression)", () => {
  it("generates a full batch of valid, distinctly-named personas", async () => {
    const mock = new MockProvider();
    const llm = {
      generate: (_providerId: string, request: LLMGenerateRequest) => mock.generate(request),
    } as unknown as LLMClient;

    const generated = await new LLMCharacterPersonaGenerator(llm).generate(7, PROFILE);

    expect(generated).toHaveLength(7);
    const displayNames = new Set(generated.map((persona) => persona.displayName));
    expect(displayNames.size).toBe(7);
    for (const persona of generated) {
      expect(persona.displayName.trim().length).toBeGreaterThan(0);
      expect(persona.description.trim().length).toBeGreaterThan(0);
      expect(persona.rolePrompt.trim().length).toBeGreaterThan(0);
      expect(persona.tonePrompt.trim().length).toBeGreaterThan(0);
      expect(persona.interests.length).toBeGreaterThan(0);
    }
  });
});

describe("characterGenerationJsonSchema", () => {
  it("forces one required object property per requested character", () => {
    const schema = characterGenerationJsonSchema(5) as {
      properties: {
        characters: {
          additionalProperties: boolean;
          required: string[];
          properties: Record<string, unknown>;
        };
      };
    };

    expect(schema.properties.characters).toMatchObject({
      additionalProperties: false,
      required: [
        "character_1",
        "character_2",
        "character_3",
        "character_4",
        "character_5",
      ],
    });
    expect(Object.keys(schema.properties.characters.properties)).toHaveLength(5);
  });

  /** Derived from the Zod schema (§10 in the refactor plan), so it cannot drift from the parser's limits. */
  it("carries the parser's length constraints and requires every field, including dialectPrompt", () => {
    const schema = characterGenerationJsonSchema(1) as {
      properties: {
        characters: {
          properties: {
            character_1: {
              additionalProperties: boolean;
              required: string[];
              properties: {
                displayName: { maxLength: number };
                interests: { minItems: number; maxItems: number };
              };
            };
          };
        };
      };
    };

    const character = schema.properties.characters.properties.character_1;
    expect(character.additionalProperties).toBe(false);
    expect(character.required).toEqual([
      "displayName",
      "description",
      "rolePrompt",
      "tonePrompt",
      "dialectPrompt",
      "interests",
    ]);
    expect(character.properties.displayName.maxLength).toBe(80);
    expect(character.properties.interests).toMatchObject({ minItems: 1, maxItems: 20 });
  });
});
