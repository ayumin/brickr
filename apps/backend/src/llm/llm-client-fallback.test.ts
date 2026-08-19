/**
 * Tests for the LLMClient runtime fallback chain (issue #180).
 *
 * Fallback order: Primary → Gemini → Mock
 */
import { describe, expect, it, vi } from "vitest";
import { LLMClient } from "./llm-client.js";
import { LLMProviderRegistry } from "./provider-registry.js";
import type { LLMGenerateRequest, LLMGenerateResult, LLMProvider } from "./provider.js";
import { LLMError } from "./provider.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvider(
  id: "openai" | "anthropic" | "gemini" | "mock",
  generate: (req: LLMGenerateRequest) => Promise<LLMGenerateResult>,
): LLMProvider {
  return {
    id,
    available: true,
    defaultModel: `${id}-default-model`,
    listModels: () => Promise.resolve([]),
    generate,
  };
}

function successProvider(
  id: "openai" | "anthropic" | "gemini" | "mock",
  text = `response from ${id}`,
): LLMProvider {
  return makeProvider(id, () =>
    Promise.resolve({ text, model: `${id}-model`, providerId: id }),
  );
}

function failingProvider(
  id: "openai" | "anthropic" | "gemini" | "mock",
  error: Error,
): LLMProvider {
  return makeProvider(id, () => Promise.reject(error));
}

/**
 * Builds a registry from an explicit list of providers.
 * Only providers in the list are "registered" (has() returns true).
 */
function makeRegistry(providers: LLMProvider[]): LLMProviderRegistry {
  const map = new Map(providers.map((p) => [p.id, p]));
  return {
    has: (id: string) => map.has(id as never) && (map.get(id as never)?.available ?? false),
    get: (id: string) => {
      const p = map.get(id as never);
      if (!p) throw new LLMError(`provider "${id}" is not registered`, id as never, false);
      return p;
    },
    availableIds: () => [...map.keys()],
  } as unknown as LLMProviderRegistry;
}

const baseRequest: LLMGenerateRequest = {
  model: "test-model",
  systemPrompt: "system",
  messages: [{ role: "user", content: "hello" }],
};

const defaultOptions = { timeoutMs: 5_000, maxRetries: 0 };

// ---------------------------------------------------------------------------
// Normal path (no fallback)
// ---------------------------------------------------------------------------

describe("LLMClient runtime fallback — normal path", () => {
  it("returns the primary provider result when it succeeds", async () => {
    const openai = successProvider("openai", "openai response");
    const gemini = successProvider("gemini", "gemini response");
    const mock = successProvider("mock", "mock response");

    const client = new LLMClient(
      makeRegistry([openai, gemini, mock]),
      defaultOptions,
    );

    const result = await client.generate("openai", baseRequest);
    expect(result.text).toBe("openai response");
    expect(result.providerId).toBe("openai");
  });
});

// ---------------------------------------------------------------------------
// Primary → Gemini fallback
// ---------------------------------------------------------------------------

describe("LLMClient runtime fallback — Primary → Gemini", () => {
  it("falls back to Gemini when the primary provider throws a retryable error", async () => {
    const openai = failingProvider("openai", new Error("connection refused"));
    const gemini = successProvider("gemini", "gemini response");
    const mock = successProvider("mock", "mock response");

    const client = new LLMClient(
      makeRegistry([openai, gemini, mock]),
      defaultOptions,
    );

    const result = await client.generate("openai", baseRequest);
    expect(result.text).toBe("gemini response");
    expect(result.providerId).toBe("gemini");
  });

  it("uses the Gemini default model when falling back from a different primary", async () => {
    const openai = failingProvider("openai", new Error("timeout"));
    const gemini = successProvider("gemini");
    const mock = successProvider("mock");

    const generateSpy = vi.spyOn(gemini, "generate");

    const client = new LLMClient(
      makeRegistry([openai, gemini, mock]),
      defaultOptions,
    );

    await client.generate("openai", { ...baseRequest, model: "gpt-4o" });

    // The model passed to Gemini must be Gemini's own default, not "gpt-4o".
    expect(generateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gemini-default-model" }),
    );
  });

  it("uses the fallbackModel resolver when provided", async () => {
    const openai = failingProvider("openai", new Error("timeout"));
    const gemini = successProvider("gemini");
    const mock = successProvider("mock");

    const generateSpy = vi.spyOn(gemini, "generate");
    const fallbackModel = vi.fn((_id: string) => "gemini-2.0-flash");

    const client = new LLMClient(
      makeRegistry([openai, gemini, mock]),
      defaultOptions,
      undefined,
      undefined,
      fallbackModel,
    );

    await client.generate("openai", baseRequest);

    expect(fallbackModel).toHaveBeenCalledWith("gemini");
    expect(generateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gemini-2.0-flash" }),
    );
  });
});

// ---------------------------------------------------------------------------
// Primary → Gemini → Mock fallback
// ---------------------------------------------------------------------------

describe("LLMClient runtime fallback — Primary → Gemini → Mock", () => {
  it("falls back to Mock when both primary and Gemini fail", async () => {
    const openai = failingProvider("openai", new Error("openai down"));
    const gemini = failingProvider("gemini", new Error("gemini down"));
    const mock = successProvider("mock", "mock response");

    const client = new LLMClient(
      makeRegistry([openai, gemini, mock]),
      defaultOptions,
    );

    const result = await client.generate("openai", baseRequest);
    expect(result.text).toBe("mock response");
    expect(result.providerId).toBe("mock");
  });

  it("throws when all providers in the chain fail", async () => {
    const openai = failingProvider("openai", new Error("openai down"));
    const gemini = failingProvider("gemini", new Error("gemini down"));
    const mock = failingProvider("mock", new Error("mock down"));

    const client = new LLMClient(
      makeRegistry([openai, gemini, mock]),
      defaultOptions,
    );

    await expect(client.generate("openai", baseRequest)).rejects.toBeInstanceOf(LLMError);
  });
});

// ---------------------------------------------------------------------------
// Gemini as primary
// ---------------------------------------------------------------------------

describe("LLMClient runtime fallback — Gemini as primary", () => {
  it("does not duplicate Gemini in the chain when Gemini is the primary", async () => {
    const gemini = failingProvider("gemini", new Error("gemini down"));
    const mock = successProvider("mock", "mock response");

    const client = new LLMClient(
      makeRegistry([gemini, mock]),
      defaultOptions,
    );

    // Chain should be ["gemini", "mock"] — Gemini appears only once.
    const result = await client.generate("gemini", baseRequest);
    expect(result.text).toBe("mock response");
  });
});

// ---------------------------------------------------------------------------
// Fallback skips unregistered providers
// ---------------------------------------------------------------------------

describe("LLMClient runtime fallback — unregistered providers are skipped", () => {
  it("skips Gemini and falls back to Mock when Gemini is not registered", async () => {
    const openai = failingProvider("openai", new Error("openai down"));
    const mock = successProvider("mock", "mock response");

    // Gemini is NOT in the registry.
    const client = new LLMClient(
      makeRegistry([openai, mock]),
      defaultOptions,
    );

    const result = await client.generate("openai", baseRequest);
    expect(result.text).toBe("mock response");
  });
});

// ---------------------------------------------------------------------------
// Non-fallback cases
// ---------------------------------------------------------------------------

describe("LLMClient runtime fallback — non-fallback cases", () => {
  it("does not fall back on AbortError (user-cancelled request)", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";

    const openai = failingProvider("openai", abortError);
    const gemini = successProvider("gemini", "gemini response");
    const mock = successProvider("mock", "mock response");

    const generateSpy = vi.spyOn(gemini, "generate");

    const client = new LLMClient(
      makeRegistry([openai, gemini, mock]),
      defaultOptions,
    );

    await expect(client.generate("openai", baseRequest)).rejects.toMatchObject({
      name: "LLMError",
    });

    // Gemini must NOT have been called.
    expect(generateSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

describe("LLMClient runtime fallback — logging", () => {
  it("logs a fallback event when falling back to Gemini", async () => {
    const openai = failingProvider("openai", new Error("timeout"));
    const gemini = successProvider("gemini");
    const mock = successProvider("mock");

    const logger = { debug: vi.fn() };

    const client = new LLMClient(
      makeRegistry([openai, gemini, mock]),
      defaultOptions,
      logger,
    );

    await client.generate("openai", baseRequest);

    // At least one log entry should mention the fallback.
    const calls = logger.debug.mock.calls.map((c) => c[0] as string);
    const fallbackLog = calls.find((msg) => msg.includes("primary=openai") && msg.includes("fallback=gemini"));
    expect(fallbackLog).toBeDefined();
    expect(fallbackLog).toMatch(/result=success/);
  });

  it("logs primary=openai attempted=openai result=retrying_next when primary fails", async () => {
    const openai = failingProvider("openai", new Error("connection error"));
    const gemini = successProvider("gemini");
    const mock = successProvider("mock");

    const logger = { debug: vi.fn() };

    const client = new LLMClient(
      makeRegistry([openai, gemini, mock]),
      defaultOptions,
      logger,
    );

    await client.generate("openai", baseRequest);

    const calls = logger.debug.mock.calls.map((c) => c[0] as string);
    // "attempted" names the provider that just failed (openai), not the
    // provider about to be tried next (gemini) — see logFallback's docstring.
    const retryLog = calls.find(
      (msg) => msg.includes("primary=openai") && msg.includes("attempted=openai") && msg.includes("retrying_next"),
    );
    expect(retryLog).toBeDefined();
  });

  it("logs result=failed when all providers are exhausted", async () => {
    const openai = failingProvider("openai", new Error("openai down"));
    const gemini = failingProvider("gemini", new Error("gemini down"));
    const mock = failingProvider("mock", new Error("mock down"));

    const logger = { debug: vi.fn() };

    const client = new LLMClient(
      makeRegistry([openai, gemini, mock]),
      defaultOptions,
      logger,
    );

    await client.generate("openai", baseRequest).catch(() => {});

    const calls = logger.debug.mock.calls.map((c) => c[0] as string);
    const failedLog = calls.find((msg) => msg.includes("result=failed"));
    expect(failedLog).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Budget interaction with fallback
// ---------------------------------------------------------------------------

describe("LLMClient runtime fallback — budget interaction", () => {
  it("falls back to Gemini when the primary provider's budget is exceeded", async () => {
    const openai = successProvider("openai", "openai response");
    const gemini = successProvider("gemini", "gemini response");
    const mock = successProvider("mock", "mock response");

    const budgetChecker = {
      isAllowed: vi.fn((id: string) => Promise.resolve(id !== "openai")),
      recordUsage: vi.fn(() => Promise.resolve()),
    };

    const client = new LLMClient(
      makeRegistry([openai, gemini, mock]),
      defaultOptions,
      undefined,
      undefined,
      undefined,
      budgetChecker,
    );

    const result = await client.generate("openai", baseRequest);
    // Should have fallen back to Gemini since OpenAI budget is exceeded.
    expect(result.text).toBe("gemini response");
  });

  it("falls back to Mock when both primary and Gemini budgets are exceeded", async () => {
    const openai = successProvider("openai");
    const gemini = successProvider("gemini");
    const mock = successProvider("mock", "mock response");

    const budgetChecker = {
      isAllowed: vi.fn((id: string) => Promise.resolve(id === "mock")),
      recordUsage: vi.fn(() => Promise.resolve()),
    };

    const client = new LLMClient(
      makeRegistry([openai, gemini, mock]),
      defaultOptions,
      undefined,
      undefined,
      undefined,
      budgetChecker,
    );

    // Mock is exempt from budget checks, so it should succeed.
    const result = await client.generate("openai", baseRequest);
    expect(result.text).toBe("mock response");
  });

  it("surfaces a budget-checker infrastructure failure instead of silently degrading to Gemini/Mock", async () => {
    const openai = successProvider("openai", "openai response");
    const gemini = successProvider("gemini", "gemini response");
    const mock = successProvider("mock", "mock response");

    const geminiSpy = vi.spyOn(gemini, "generate");
    const mockSpy = vi.spyOn(mock, "generate");

    const budgetChecker = {
      // The checker itself is unhealthy (e.g. its DB is unreachable) — this
      // must not be treated the same as an intentional "not allowed" result,
      // or every character would quietly degrade to Mock during an outage.
      isAllowed: vi.fn(() => Promise.reject(new Error("budget database unavailable"))),
      recordUsage: vi.fn(() => Promise.resolve()),
    };

    const client = new LLMClient(
      makeRegistry([openai, gemini, mock]),
      defaultOptions,
      undefined,
      undefined,
      undefined,
      budgetChecker,
    );

    await expect(client.generate("openai", baseRequest)).rejects.toMatchObject({
      message: "openai request failed: budget database unavailable",
    });

    // Gemini and Mock are healthy and registered, but must never be reached —
    // the infra failure aborts the chain rather than falling through to them.
    expect(geminiSpy).not.toHaveBeenCalled();
    expect(mockSpy).not.toHaveBeenCalled();
  });
});
