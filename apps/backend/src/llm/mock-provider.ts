/**
 * Mock provider.
 *
 * Exists so the whole application runs with zero API keys: no network, small
 * simulated latency, and a short Japanese sentence derived from the prompt so
 * different characters still look different in the timeline.
 */

import type { LLMGenerateRequest, LLMGenerateResult, LLMProvider } from "./provider.js";

const PROVIDER_ID = "mock" as const;

const MIN_DELAY_MS = 100;
const MAX_DELAY_MS = 400;

const REACTIONS = [
  "なるほど、そこは一度整理した方がええと思う。",
  "その前提、少し疑ってみた方がいいかもしれません。",
  "別の見方をすると、もっと簡単な選択肢もありそうです。",
  "個人的にはまず小さく試すのが現実的だと思います。",
  "面白い視点ですね。運用まで含めて考えたいところです。",
  "同意します。ただ例外ケースの扱いは決めておきたい。",
] as const;

export class MockProvider implements LLMProvider {
  readonly id = PROVIDER_ID;
  readonly available = true;
  /** No real model behind this; the value is only ever echoed back. */
  readonly defaultModel = "mock";

  async generate(request: LLMGenerateRequest): Promise<LLMGenerateResult> {
    const persona = fragment(request.systemPrompt, 12);
    const lastUser = lastUserMessage(request.messages);
    const seed = hash(`${request.systemPrompt}|${lastUser}`);

    await delay(MIN_DELAY_MS + (seed % (MAX_DELAY_MS - MIN_DELAY_MS)));

    const reaction = REACTIONS[seed % REACTIONS.length] ?? REACTIONS[0];
    const quoted = fragment(lastUser, 24);
    const text = quoted
      ? `「${quoted}」について。${reaction}${persona ? `（${persona}）` : ""}`
      : `${reaction}${persona ? `（${persona}）` : ""}`;

    return { text, model: request.model, providerId: PROVIDER_ID };
  }
}

function lastUserMessage(messages: LLMGenerateRequest["messages"]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message !== undefined && message.role === "user") {
      return message.content;
    }
  }
  return "";
}

function fragment(source: string, length: number): string {
  const normalized = source.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return "";
  return normalized.length <= length ? normalized : `${normalized.slice(0, length)}…`;
}

/** Tiny deterministic string hash (FNV-1a style), kept non-negative. */
function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return Math.abs(result | 0);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
