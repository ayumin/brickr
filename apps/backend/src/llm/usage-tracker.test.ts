import { describe, expect, it } from "vitest";
import { LLMUsageTracker } from "./usage-tracker.js";

describe("LLMUsageTracker", () => {
  it("aggregates usage by the provider and actual model that served a request", () => {
    const tracker = new LLMUsageTracker();
    tracker.record({
      text: "one",
      providerId: "openai",
      model: "gpt-test",
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
    });
    tracker.record({
      text: "two",
      providerId: "openai",
      model: "gpt-test",
      usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11 },
    });

    expect(tracker.snapshot()).toEqual([
      {
        providerId: "openai",
        model: "gpt-test",
        requestCount: 2,
        inputTokens: 18,
        outputTokens: 7,
        totalTokens: 25,
      },
    ]);
  });

  it("counts successful requests even when a provider does not report tokens", () => {
    const tracker = new LLMUsageTracker();
    tracker.record({ text: "mock", providerId: "mock", model: "mock" });
    expect(tracker.snapshot()[0]).toMatchObject({ requestCount: 1, totalTokens: 0 });
  });
});
