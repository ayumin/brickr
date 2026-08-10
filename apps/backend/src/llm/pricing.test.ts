import { describe, expect, it } from "vitest";
import { estimateLLMCostUsd, standardTokenPrice } from "./pricing.js";

describe("LLM standard pricing", () => {
  it("matches dated model identifiers to their model-family list price", () => {
    expect(standardTokenPrice("openai", "gpt-4o-mini-2024-07-18")).toEqual({
      inputPerMillionUsd: 0.15,
      outputPerMillionUsd: 0.6,
    });
    expect(standardTokenPrice("anthropic", "claude-sonnet-5-20260801")).toEqual({
      inputPerMillionUsd: 3,
      outputPerMillionUsd: 15,
    });
    expect(standardTokenPrice("gemini", "gemini-3.5-flash-lite")).toEqual({
      inputPerMillionUsd: 0.3,
      outputPerMillionUsd: 2.5,
    });
  });

  it("estimates input and output independently and rejects unknown prices", () => {
    expect(
      estimateLLMCostUsd({
        providerId: "openai",
        model: "gpt-4o-mini",
        requestCount: 1,
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        totalTokens: 2_000_000,
      }),
    ).toBeCloseTo(0.75);
    expect(standardTokenPrice("openai", "unknown-model")).toBeNull();
  });
});
