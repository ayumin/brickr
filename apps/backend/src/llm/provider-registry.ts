/**
 * Provider registry.
 *
 * Resolves `Character -> ModelProfile -> providerId` into a concrete provider
 * implementation. This is the only place that knows which providers exist.
 */

import { env } from "../config/env.js";
import { AnthropicProvider } from "./anthropic-provider.js";
import { GeminiProvider } from "./gemini-provider.js";
import { MockProvider } from "./mock-provider.js";
import { OpenAIProvider } from "./openai-provider.js";
import { LLMError, type LLMProvider, type ProviderId } from "./provider.js";

export class LLMProviderRegistry {
  private readonly providers: Map<ProviderId, LLMProvider>;

  constructor(providers: LLMProvider[]) {
    this.providers = new Map(providers.map((provider) => [provider.id, provider]));
  }

  /** Throws when the provider is unknown or has no credentials configured. */
  get(providerId: ProviderId): LLMProvider {
    const provider = this.providers.get(providerId);
    if (provider === undefined) {
      throw new LLMError(`provider "${providerId}" is not registered`, providerId, false);
    }
    if (!provider.available) {
      throw new LLMError(`provider "${providerId}" is not available`, providerId, false);
    }
    return provider;
  }

  has(providerId: ProviderId): boolean {
    return this.providers.get(providerId)?.available === true;
  }

  availableIds(): ProviderId[] {
    const ids: ProviderId[] = [];
    for (const [id, provider] of this.providers) {
      if (provider.available) ids.push(id);
    }
    return ids;
  }
}

/**
 * Builds the registry from environment configuration.
 *
 * The mock provider is always registered so the app boots without any API key.
 * When `USE_MOCK_LLM` is set, it is the *only* provider.
 */
export function createProviderRegistry(): LLMProviderRegistry {
  const providers: LLMProvider[] = [new MockProvider()];

  if (env.llm.useMock) {
    return new LLMProviderRegistry(providers);
  }

  if (env.openai.apiKey) {
    providers.push(new OpenAIProvider({ apiKey: env.openai.apiKey }));
  }
  if (env.anthropic.apiKey) {
    providers.push(new AnthropicProvider({ apiKey: env.anthropic.apiKey }));
  }
  if (env.gemini.apiKey) {
    providers.push(new GeminiProvider({ apiKey: env.gemini.apiKey }));
  }

  return new LLMProviderRegistry(providers);
}
