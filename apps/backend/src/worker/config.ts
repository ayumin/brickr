/**
 * Worker-specific configuration, read from environment variables.
 *
 * The worker shares the same DATABASE_URL as the API process. All other
 * settings have sensible defaults so the worker starts without extra config.
 */

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

export const workerConfig = {
  /**
   * How long to sleep between polls when no event is available (ms).
   * Jitter is added at runtime to spread concurrent workers.
   */
  pollIntervalMs: int("WORKER_POLL_INTERVAL_MS", 2_000),

  /**
   * Maximum jitter added to the poll interval (ms).
   * Each worker sleeps for `pollIntervalMs + random(0, pollJitterMs)`.
   */
  pollJitterMs: int("WORKER_POLL_JITTER_MS", 1_000),

  /**
   * Maximum number of execution attempts before an event is permanently failed.
   * Matches the length of RETRY_DELAYS so every delay is used at least once.
   */
  maxAttempts: int("WORKER_MAX_ATTEMPTS", 4),

  /**
   * Port for the worker's HTTP health endpoint.
   * Each worker replica must bind a distinct port if running on the same host.
   */
  healthPort: int("WORKER_HEALTH_PORT", 3001),

  /**
   * Host for the worker's HTTP health endpoint.
   */
  healthHost: str("WORKER_HEALTH_HOST", "0.0.0.0"),

  /**
   * Log level forwarded to the logger.
   */
  logLevel: str("LOG_LEVEL", "info"),
} as const;

/**
 * Exponential backoff delays between retry attempts (ms).
 * Index 0 is used after the first failure, index 1 after the second, etc.
 * The last value is reused for any attempt beyond the array length.
 */
export const RETRY_DELAYS_MS = [1_000, 5_000, 30_000, 300_000] as const;
