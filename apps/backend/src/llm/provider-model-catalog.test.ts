import { describe, expect, it } from "vitest";
import { geminiGenerationModelId, isThinkingConfigRejection } from "./gemini-provider.js";
import { isOpenAICharacterModel } from "./openai-provider.js";
import { LLMProviderRegistry } from "./provider-registry.js";
import type {
  LLMGenerateRequest,
  LLMGenerateResult,
  LLMProvider,
  ProviderId,
} from "./provider.js";

describe("provider model filters", () => {
  it("keeps OpenAI conversational models and fine-tunes", () => {
    expect(isOpenAICharacterModel("gpt-5-mini")).toBe(true);
    expect(isOpenAICharacterModel("o4-mini")).toBe(true);
    expect(isOpenAICharacterModel("o5-mini")).toBe(true);
    expect(isOpenAICharacterModel("ft:gpt-4o-mini:org:custom")).toBe(true);
  });

  it("excludes OpenAI models for incompatible endpoints", () => {
    expect(isOpenAICharacterModel("text-embedding-3-small")).toBe(false);
    expect(isOpenAICharacterModel("gpt-image-1")).toBe(false);
    expect(isOpenAICharacterModel("gpt-4o-realtime-preview")).toBe(false);
    expect(isOpenAICharacterModel("gpt-5-codex")).toBe(false);
  });

  it("keeps only Gemini generateContent models and normalizes resource names", () => {
    expect(
      geminiGenerationModelId("models/gemini-2.5-flash", ["generateContent"]),
    ).toBe("gemini-2.5-flash");
    expect(geminiGenerationModelId("models/text-embedding-004", ["embedContent"])).toBeNull();
    expect(geminiGenerationModelId(undefined, ["generateContent"])).toBeNull();
  });

  it("recognizes Gemini's rejection of thinkingConfig on non-thinking models", () => {
    const rejection = sdkError(400, "Thinking config is not supported for this model.");
    expect(isThinkingConfigRejection(rejection, ["status", "code"])).toBe(true);
  });

  it("does not mistake an unrelated 400 for a thinkingConfig rejection", () => {
    const unrelated = sdkError(400, "Request contains an invalid argument.");
    expect(isThinkingConfigRejection(unrelated, ["status", "code"])).toBe(false);
  });

  it("does not mistake a non-400 thinking-related error for a rejection", () => {
    const rateLimited = sdkError(429, "thinking budget exceeded rate limit");
    expect(isThinkingConfigRejection(rateLimited, ["status", "code"])).toBe(false);
  });
});

describe("LLMProviderRegistry.listAvailableModels", () => {
  it("returns successful catalogs when another provider fails", async () => {
    const registry = new LLMProviderRegistry([
      fakeProvider("openai", ["gpt-test"]),
      fakeProvider("anthropic", [], new Error("invalid key")),
    ]);

    await expect(registry.listAvailableModels()).resolves.toEqual({
      catalogs: [
        {
          providerId: "openai",
          models: [{ id: "gpt-test", displayName: "gpt-test" }],
        },
      ],
      failures: [{ providerId: "anthropic", reason: "invalid key" }],
    });
  });
});

describe("LLMProviderRegistry.preferred", () => {
  it("returns openai when openai and gemini are both available", () => {
    const registry = new LLMProviderRegistry([
      fakeProvider("gemini", []),
      fakeProvider("openai", []),
    ]);
    expect(registry.preferred()?.id).toBe("openai");
  });

  it("skips an unavailable provider and returns the next in order", () => {
    const registry = new LLMProviderRegistry([
      fakeProvider("openai", [], undefined, { available: false }),
      fakeProvider("anthropic", []),
    ]);
    expect(registry.preferred()?.id).toBe("anthropic");
  });

  it("returns null when only the mock is registered", () => {
    const registry = new LLMProviderRegistry([fakeProvider("mock", [])]);
    expect(registry.preferred()).toBeNull();
  });

  it("returns null for an empty registry", () => {
    const registry = new LLMProviderRegistry([]);
    expect(registry.preferred()).toBeNull();
  });
});

/** Mimics the GenAI SDK's error shape: an `Error` with an extra `status` field. */
function sdkError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

function fakeProvider(
  id: ProviderId,
  models: string[],
  failure?: Error,
  options?: { available?: boolean },
): LLMProvider {
  return {
    id,
    available: options?.available ?? true,
    defaultModel: models[0] ?? "test",
    listModels: () =>
      failure
        ? Promise.reject(failure)
        : Promise.resolve(models.map((model) => ({ id: model, displayName: model }))),
    generate: (_request: LLMGenerateRequest): Promise<LLMGenerateResult> =>
      Promise.resolve({ text: "test", model: "test", providerId: id }),
  };
}
