/**
 * Environment configuration. The only place that reads `process.env`.
 *
 * API keys live here and must never be forwarded to the frontend or written to
 * logs.
 */

function str(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

export const env = {
  port: int("PORT", 3000),
  host: str("HOST", "0.0.0.0"),
  logLevel: str("LOG_LEVEL", "info"),
  corsOrigins: str("CORS_ORIGIN", "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),

  openai: {
    apiKey: optional("OPENAI_API_KEY"),
    model: str("OPENAI_MODEL", "gpt-4o-mini"),
  },
  anthropic: {
    apiKey: optional("ANTHROPIC_API_KEY"),
    model: str("ANTHROPIC_MODEL", "claude-sonnet-5"),
  },
  gemini: {
    apiKey: optional("GEMINI_API_KEY"),
    model: str("GEMINI_MODEL", "gemini-3.5-flash-lite"),
  },

  llm: {
    timeoutMs: int("LLM_TIMEOUT_MS", 30_000),
    maxRetries: Math.min(int("LLM_MAX_RETRIES", 1), 2),
    useMock: bool("USE_MOCK_LLM", false),
  },

  simulation: {
    minResponders: int("MIN_RESPONDERS", 2),
    maxResponders: int("MAX_RESPONDERS", 6),
    contextPostLimit: int("CONTEXT_POST_LIMIT", 16),
    maxConcurrentCharacters: int("MAX_CONCURRENT_CHARACTERS", 4),
    maxCascadeDepth: int("MAX_CASCADE_DEPTH", 2),
  },
} as const;

export type Env = typeof env;
