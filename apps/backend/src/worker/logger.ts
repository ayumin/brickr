/**
 * Minimal structured logger for the worker process.
 *
 * Uses the same shape as Fastify's logger so the worker's log output is
 * consistent with the API's. In production both processes write JSON to stdout
 * and a log aggregator collects them.
 */

export type WorkerLogger = {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
};

type LogLevel = "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { info: 30, warn: 40, error: 50 };

function shouldLog(level: LogLevel, minLevel: string): boolean {
  const min = LEVELS[minLevel as LogLevel] ?? LEVELS.info;
  return LEVELS[level] >= min;
}

function write(level: LogLevel, minLevel: string, obj: Record<string, unknown>, msg: string): void {
  if (!shouldLog(level, minLevel)) return;
  const entry = {
    level: LEVELS[level],
    time: Date.now(),
    msg,
    ...obj,
  };
  console.log(JSON.stringify(entry));
}

export function createLogger(minLevel: string): WorkerLogger {
  return {
    info: (obj, msg) => write("info", minLevel, obj, msg),
    warn: (obj, msg) => write("warn", minLevel, obj, msg),
    error: (obj, msg) => write("error", minLevel, obj, msg),
  };
}
