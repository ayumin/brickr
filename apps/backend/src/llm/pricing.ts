import type { LLMUsageEntry } from "./usage-tracker.js";

type TokenPrice = { inputPerMillionUsd: number; outputPerMillionUsd: number };

/**
 * Standard synchronous API list prices in USD per million tokens.
 * Cached-input, batch, flex, priority, long-context and promotional rates are excluded.
 * Sources (checked 2026-08-10):
 * - https://openai.com/api/pricing/
 * - https://claude.com/pricing
 * - https://ai.google.dev/gemini-api/docs/pricing
 */
export function estimateLLMCostUsd(entry: LLMUsageEntry): number | null {
  const price = standardTokenPrice(entry.providerId, entry.model);
  if (!price) return null;
  return (
    (entry.inputTokens * price.inputPerMillionUsd +
      entry.outputTokens * price.outputPerMillionUsd) /
    1_000_000
  );
}

export function standardTokenPrice(
  providerId: LLMUsageEntry["providerId"],
  model: string,
): TokenPrice | null {
  const id = model.toLowerCase();
  if (providerId === "mock") return { inputPerMillionUsd: 0, outputPerMillionUsd: 0 };

  if (providerId === "openai") {
    if (id.startsWith("gpt-4.1-nano")) return price(0.1, 0.4);
    if (id.startsWith("gpt-4.1-mini")) return price(0.4, 1.6);
    if (id.startsWith("gpt-4.1")) return price(2, 8);
    if (id.startsWith("gpt-4o-mini")) return price(0.15, 0.6);
    if (id.startsWith("gpt-4o")) return price(2.5, 10);
    if (id.startsWith("gpt-5-nano")) return price(0.05, 0.4);
    if (id.startsWith("gpt-5-mini")) return price(0.25, 2);
    if (id.startsWith("gpt-5")) return price(1.25, 10);
    if (id === "o4-mini" || id.startsWith("o4-mini-")) return price(1.1, 4.4);
    if (id === "o3" || id.startsWith("o3-")) return price(2, 8);
    return null;
  }

  if (providerId === "anthropic") {
    if (id.includes("opus-5")) return price(5, 25);
    // Standard price after the temporary Sonnet 5 introductory period.
    if (id.includes("sonnet-5")) return price(3, 15);
    if (id.includes("opus-4") || id.includes("claude-3-opus")) return price(15, 75);
    if (id.includes("sonnet-4") || id.includes("sonnet-3-7") || id.includes("sonnet-3-5")) return price(3, 15);
    if (id.includes("haiku-4-5")) return price(1, 5);
    if (id.includes("haiku-3-5")) return price(0.8, 4);
    if (id.includes("claude-3-haiku")) return price(0.25, 1.25);
    return null;
  }

  if (providerId === "gemini") {
    if (id.startsWith("gemini-3.6-flash")) return price(1.5, 7.5);
    if (id.startsWith("gemini-3.5-flash-lite")) return price(0.3, 2.5);
    if (id.startsWith("gemini-3.5-flash")) return price(1.5, 9);
    if (id.startsWith("gemini-3.1-flash-lite")) return price(0.25, 1.5);
    if (id.startsWith("gemini-2.5-flash-lite")) return price(0.1, 0.4);
    if (id.startsWith("gemini-2.5-flash")) return price(0.3, 2.5);
    if (id.startsWith("gemini-2.5-pro")) return price(1.25, 10);
    return null;
  }

  return null;
}

function price(inputPerMillionUsd: number, outputPerMillionUsd: number): TokenPrice {
  return { inputPerMillionUsd, outputPerMillionUsd };
}
