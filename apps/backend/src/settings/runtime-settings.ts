import type { EditableApplicationSettingName } from "@brickr/shared";
import { env } from "../config/env.js";
import { DomainError } from "../domain-error.js";

export type RuntimeSettingsValues = {
  models: { openai: string; anthropic: string; gemini: string };
  llm: { timeoutMs: number; maxRetries: number };
  room: {
    minResponders: number;
    maxResponders: number;
    contextPostLimit: number;
    maxConcurrentCharacters: number;
    maxCascadeDepth: number;
  };
};

export class RuntimeSettings {
  readonly values: RuntimeSettingsValues = environmentValues();
  private overrides = new Map<EditableApplicationSettingName, string>();

  load(overrides: Map<EditableApplicationSettingName, string>): void {
    this.overrides = new Map(overrides);
    this.recompute();
  }

  isOverridden(name: EditableApplicationSettingName): boolean {
    return this.overrides.has(name);
  }

  effectiveValue(name: EditableApplicationSettingName): string {
    return settingValue(this.values, name);
  }

  preview(
    changes: Partial<Record<EditableApplicationSettingName, string | null>>,
  ): Map<EditableApplicationSettingName, string> {
    const next = new Map(this.overrides);
    for (const [name, value] of Object.entries(changes) as Array<
      [EditableApplicationSettingName, string | null]
    >) {
      if (value === null) next.delete(name);
      else next.set(name, value);
    }
    validateOverrides(next);
    return next;
  }

  private recompute(): void {
    const next = environmentValues();
    for (const [name, value] of this.overrides) applyValue(next, name, value);
    Object.assign(this.values.models, next.models);
    Object.assign(this.values.llm, next.llm);
    Object.assign(this.values.room, next.room);
  }
}

function environmentValues(): RuntimeSettingsValues {
  return {
    models: {
      openai: env.openai.model,
      anthropic: env.anthropic.model,
      gemini: env.gemini.model,
    },
    llm: { timeoutMs: env.llm.timeoutMs, maxRetries: env.llm.maxRetries },
    room: {
      minResponders: env.room.minResponders,
      maxResponders: env.room.maxResponders,
      contextPostLimit: env.room.contextPostLimit,
      maxConcurrentCharacters: env.room.maxConcurrentCharacters,
      maxCascadeDepth: env.room.maxCascadeDepth,
    },
  };
}

function validateOverrides(overrides: Map<EditableApplicationSettingName, string>): void {
  const values = environmentValues();
  for (const [name, value] of overrides) applyValue(values, name, value);
  if (values.room.minResponders > values.room.maxResponders) {
    throw new InvalidApplicationSettingError(
      "MIN_RESPONDERS must not exceed MAX_RESPONDERS",
    );
  }
}

function applyValue(
  values: RuntimeSettingsValues,
  name: EditableApplicationSettingName,
  raw: string,
): void {
  if (name === "OPENAI_MODEL" || name === "ANTHROPIC_MODEL" || name === "GEMINI_MODEL") {
    const value = raw.trim();
    if (value.length === 0 || value.length > 200) {
      throw new InvalidApplicationSettingError(`${name} must be 1-200 characters`);
    }
    values.models[name === "OPENAI_MODEL" ? "openai" : name === "ANTHROPIC_MODEL" ? "anthropic" : "gemini"] = value;
    return;
  }

  const limits: Record<Exclude<EditableApplicationSettingName, "OPENAI_MODEL" | "ANTHROPIC_MODEL" | "GEMINI_MODEL">, [number, number]> = {
    LLM_TIMEOUT_MS: [1_000, 300_000],
    LLM_MAX_RETRIES: [0, 2],
    MIN_RESPONDERS: [0, 100],
    MAX_RESPONDERS: [1, 100],
    CONTEXT_POST_LIMIT: [1, 200],
    MAX_CONCURRENT_CHARACTERS: [1, 100],
    MAX_CASCADE_DEPTH: [0, 20],
  };
  const value = Number(raw);
  const [minimum, maximum] = limits[name];
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new InvalidApplicationSettingError(
      `${name} must be an integer from ${String(minimum)} to ${String(maximum)}`,
    );
  }
  if (name === "LLM_TIMEOUT_MS") values.llm.timeoutMs = value;
  else if (name === "LLM_MAX_RETRIES") values.llm.maxRetries = value;
  else if (name === "MIN_RESPONDERS") values.room.minResponders = value;
  else if (name === "MAX_RESPONDERS") values.room.maxResponders = value;
  else if (name === "CONTEXT_POST_LIMIT") values.room.contextPostLimit = value;
  else if (name === "MAX_CONCURRENT_CHARACTERS") values.room.maxConcurrentCharacters = value;
  else values.room.maxCascadeDepth = value;
}

function settingValue(values: RuntimeSettingsValues, name: EditableApplicationSettingName): string {
  if (name === "OPENAI_MODEL") return values.models.openai;
  if (name === "ANTHROPIC_MODEL") return values.models.anthropic;
  if (name === "GEMINI_MODEL") return values.models.gemini;
  if (name === "LLM_TIMEOUT_MS") return String(values.llm.timeoutMs);
  if (name === "LLM_MAX_RETRIES") return String(values.llm.maxRetries);
  if (name === "MIN_RESPONDERS") return String(values.room.minResponders);
  if (name === "MAX_RESPONDERS") return String(values.room.maxResponders);
  if (name === "CONTEXT_POST_LIMIT") return String(values.room.contextPostLimit);
  if (name === "MAX_CONCURRENT_CHARACTERS") return String(values.room.maxConcurrentCharacters);
  return String(values.room.maxCascadeDepth);
}

export class InvalidApplicationSettingError extends DomainError {
  readonly httpStatus = 400;
  readonly errorCode = "invalid_setting" as const;
}
