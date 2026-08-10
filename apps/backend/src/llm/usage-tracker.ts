import type { LLMGenerateResult, ProviderId } from "./provider.js";

export type LLMUsageEntry = {
  providerId: ProviderId;
  model: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export class LLMUsageTracker {
  readonly trackedSince = new Date();
  private readonly entries = new Map<string, LLMUsageEntry>();

  record(result: LLMGenerateResult): void {
    const key = `${result.providerId}\u0000${result.model}`;
    const current = this.entries.get(key) ?? {
      providerId: result.providerId,
      model: result.model,
      requestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
    const usage = result.usage;
    current.requestCount += 1;
    current.inputTokens += usage?.inputTokens ?? 0;
    current.outputTokens += usage?.outputTokens ?? 0;
    current.totalTokens += usage?.totalTokens ?? 0;
    this.entries.set(key, current);
  }

  snapshot(): LLMUsageEntry[] {
    return [...this.entries.values()]
      .map((entry) => ({ ...entry }))
      .sort((a, b) =>
        a.providerId.localeCompare(b.providerId) || a.model.localeCompare(b.model),
      );
  }
}
