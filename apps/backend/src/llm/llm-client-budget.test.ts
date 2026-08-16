/**
 * Tests for the LLMClient budget circuit-breaker integration (issue #162).
 */
import { describe, expect, it, vi } from "vitest";
import { LLMClient, LLMBudgetExceededError } from "./llm-client.js";
import { LLMProviderRegistry } from "./provider-registry.js";
import type { LLMBudgetChecker } from "./llm-client.js";
import type { LLMGenerateRequest, LLMGenerateResult } from "./provider.js";
import { LLMError } from "./provider.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRegistry(providerId: "openai" | "mock" = "openai") {
  const provider = {
    id: providerId,
    available: true,
    defaultModel: "test-model",
    listModels: () => Promise.resolve([]),
    generate: (_req: LLMGenerateRequest): Promise<LLMGenerateResult> =>
      Promise.resolve({
        text: "テスト投稿です。",
        model: "test-model",
        providerId,
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      }),
  };

  const registry = {
    has: (id: string) => id === providerId,
    get: () => provider,
    availableIds: () => [providerId],
  } as unknown as LLMProviderRegistry;

  return { registry, provider };
}

const baseRequest: LLMGenerateRequest = {
  model: "test-model",
  systemPrompt: "system",
  messages: [{ role: "user", content: "hello" }],
};

// ---------------------------------------------------------------------------
// Budget check
// ---------------------------------------------------------------------------

describe("LLMClient budget circuit-breaker", () => {
  it("calls the provider normally when the budget checker allows it", async () => {
    const { registry } = makeRegistry("openai");
    const budgetChecker: LLMBudgetChecker = {
      isAllowed: vi.fn(() => Promise.resolve(true)),
      recordUsage: vi.fn(() => Promise.resolve()),
    };

    const client = new LLMClient(
      registry,
      { timeoutMs: 5_000, maxRetries: 0 },
      undefined,
      undefined,
      undefined,
      budgetChecker,
    );

    const result = await client.generate("openai", baseRequest);
    expect(result.text).toBe("テスト投稿です。");
    expect(budgetChecker.isAllowed).toHaveBeenCalledWith("openai");
  });

  it("throws LLMBudgetExceededError when the budget checker denies the call", async () => {
    const { registry } = makeRegistry("openai");
    const budgetChecker: LLMBudgetChecker = {
      isAllowed: vi.fn(() => Promise.resolve(false)),
      recordUsage: vi.fn(() => Promise.resolve()),
    };

    const client = new LLMClient(
      registry,
      { timeoutMs: 5_000, maxRetries: 0 },
      undefined,
      undefined,
      undefined,
      budgetChecker,
    );

    await expect(client.generate("openai", baseRequest)).rejects.toBeInstanceOf(
      LLMBudgetExceededError,
    );
  });

  it("normalizes a budget checker failure as an LLMError", async () => {
    const { registry } = makeRegistry("openai");
    const cause = new Error("budget database unavailable");
    const budgetChecker: LLMBudgetChecker = {
      isAllowed: vi.fn(() => Promise.reject(cause)),
      recordUsage: vi.fn(() => Promise.resolve()),
    };
    const client = new LLMClient(
      registry,
      { timeoutMs: 5_000, maxRetries: 0 },
      undefined,
      undefined,
      undefined,
      budgetChecker,
    );

    const error = await client.generate("openai", baseRequest).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(LLMError);
    expect(error).toMatchObject({
      providerId: "openai",
      retryable: true,
      message: "openai request failed: budget database unavailable",
      cause,
    });
  });

  it("does not check the budget for the mock provider", async () => {
    const { registry } = makeRegistry("mock");
    const budgetChecker: LLMBudgetChecker = {
      isAllowed: vi.fn(() => Promise.resolve(false)), // would block if checked
      recordUsage: vi.fn(() => Promise.resolve()),
    };

    const client = new LLMClient(
      registry,
      { timeoutMs: 5_000, maxRetries: 0 },
      undefined,
      undefined,
      undefined,
      budgetChecker,
    );

    // Should succeed because mock is exempt from budget checks
    const result = await client.generate("mock", baseRequest);
    expect(result.text).toBe("テスト投稿です。");
    expect(budgetChecker.isAllowed).not.toHaveBeenCalled();
  });

  it("does not check the budget when no budget checker is configured", async () => {
    const { registry } = makeRegistry("openai");

    const client = new LLMClient(
      registry,
      { timeoutMs: 5_000, maxRetries: 0 },
    );

    // Should succeed without any budget checker
    const result = await client.generate("openai", baseRequest);
    expect(result.text).toBe("テスト投稿です。");
  });

  it("LLMBudgetExceededError is not retryable", () => {
    const error = new LLMBudgetExceededError("openai");
    expect(error.retryable).toBe(false);
    expect(error.providerId).toBe("openai");
    expect(error.name).toBe("LLMBudgetExceededError");
  });
});
