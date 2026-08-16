import type { ModelProfileDto } from "./character.js";

// -- LLM Budget (issue #162) -----------------------------------------------

/** Per-provider budget and circuit-breaker state. Admin-only. */
export type ProviderBudgetDto = {
  /** Provider identifier, e.g. "openai", "anthropic", "gemini". */
  provider: string;
  /** Administrator-configured token ceiling. 0 means no limit. */
  tokenLimit: number;
  /** Running total of tokens consumed across all rooms. */
  totalTokens: number;
  /** True when the circuit breaker is open (budget exceeded). */
  stopped: boolean;
};

export type LLMBudgetResponse = {
  providers: ProviderBudgetDto[];
};

export type SetProviderBudgetRequest = {
  /** Token ceiling. 0 removes the limit without resetting usage. */
  tokenLimit: number;
};

export type ResetProviderBudgetResponse = {
  provider: ProviderBudgetDto;
};

// --------------------------------------------------------------------------

export const EDITABLE_APPLICATION_SETTING_NAMES = [
  "OPENAI_MODEL",
  "ANTHROPIC_MODEL",
  "GEMINI_MODEL",
  "LLM_TIMEOUT_MS",
  "LLM_MAX_RETRIES",
  "MIN_RESPONDERS",
  "MAX_RESPONDERS",
  "CONTEXT_POST_LIMIT",
  "MAX_CONCURRENT_CHARACTERS",
  "MAX_CASCADE_DEPTH",
] as const;

export type EditableApplicationSettingName =
  (typeof EDITABLE_APPLICATION_SETTING_NAMES)[number];

export type EnvironmentSettingDto = {
  name: string;
  description: string;
  value: string;
  /** Secret values are represented only by their configured state. */
  secret: boolean;
  editable: boolean;
  source: "environment" | "override";
  inputType: "text" | "number" | "toggle";
};

export type UpdateApplicationSettingsRequest = {
  /** A string saves an override; null removes it and restores the environment value. */
  overrides: Partial<Record<EditableApplicationSettingName, string | null>>;
};

export type LLMProviderSettingDto = {
  providerId: "openai" | "anthropic" | "gemini" | "mock";
  available: boolean;
  defaultModel: string;
};

export type LLMTokenUsageDto = {
  providerId: "openai" | "anthropic" | "gemini" | "mock";
  model: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Standard API list-price estimate; null when the model price is unknown. */
  estimatedCostUsd: number | null;
};

export type ApplicationSettingsResponse = {
  environment: EnvironmentSettingDto[];
  llm: {
    providers: LLMProviderSettingDto[];
    models: ModelProfileDto[];
    usage: {
      trackedSince: string;
      entries: LLMTokenUsageDto[];
    };
  };
};
