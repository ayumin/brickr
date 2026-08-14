import { describe, expect, it } from "vitest";
import { MockProvider } from "./mock-provider.js";
import type { LLMGenerateRequest } from "./provider.js";

describe("MockProvider.generate", () => {
  it("returns a deterministic Japanese sentence when no structured output is requested", async () => {
    const provider = new MockProvider();
    const request: LLMGenerateRequest = {
      model: "test-model",
      systemPrompt: "architect role prompt",
      messages: [{ role: "user", content: "RAGって本当に必要？" }],
    };

    const first = await provider.generate(request);
    const second = await provider.generate(request);

    expect(first.text).toBe(second.text);
    expect(first.text.length).toBeGreaterThan(0);
    expect(first.providerId).toBe("mock");
    expect(first.model).toBe("test-model");
  });

  it("returns parseable JSON matching the schema when structured output is requested", async () => {
    const provider = new MockProvider();
    const request: LLMGenerateRequest = {
      model: "test-model",
      systemPrompt: "generate personas",
      messages: [{ role: "user", content: "count: 2\nbatch: 1" }],
      structuredOutput: {
        name: "test_schema",
        schema: {
          type: "object",
          properties: {
            character_1: {
              type: "object",
              properties: { displayName: { type: "string" } },
              required: ["displayName"],
            },
            character_2: {
              type: "object",
              properties: { displayName: { type: "string" } },
              required: ["displayName"],
            },
          },
          required: ["character_1", "character_2"],
        },
      },
    };

    const result = await provider.generate(request);
    const parsed = JSON.parse(result.text) as {
      character_1: { displayName: string };
      character_2: { displayName: string };
    };

    expect(parsed.character_1.displayName.length).toBeGreaterThan(0);
    expect(parsed.character_2.displayName.length).toBeGreaterThan(0);
    expect(result.providerId).toBe("mock");
    expect(result.model).toBe("test-model");
  });
});
