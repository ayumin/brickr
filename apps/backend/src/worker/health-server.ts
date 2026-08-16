/**
 * Minimal HTTP health endpoint for the worker process.
 *
 * Docker Compose and orchestrators use this to determine whether the worker
 * is alive. The endpoint returns:
 *
 *   GET /health → 200 { status: "ok", workerId, lastPollAt, lastSuccessAt, queueDepth }
 *              → 503 { status: "error", ..., queueDepth: null, error }
 *
 * `queueDepth` is the number of pending events in the queue, which lets an
 * operator see at a glance whether the worker is keeping up.
 *
 * Uses Node's built-in `http` module — no Fastify dependency — to keep the
 * worker's startup time and memory footprint small.
 */

import { createServer, type Server } from "node:http";
import type { ScheduledEventRepository } from "../scheduled-events/scheduled-event-repository.js";
import type { WorkerLogger } from "./logger.js";

export type WorkerHealthState = {
  workerId: string;
  /** ISO timestamp of the last poll attempt, or null if none yet. */
  lastPollAt: string | null;
  /** ISO timestamp of the last successfully completed event, or null if none yet. */
  lastSuccessAt: string | null;
};

/**
 * Starts the health HTTP server and returns a handle to stop it.
 *
 * The server reads live state from the mutable `state` object on every
 * request, so callers update `state` in place as the worker runs.
 */
export function startHealthServer(
  host: string,
  port: number,
  state: WorkerHealthState,
  eventRepo: ScheduledEventRepository,
  logger: WorkerLogger,
): Server {
  const server = createServer((req, res) => {
    if (req.method !== "GET" || req.url !== "/health") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }

    // Fetch queue depth asynchronously. A DB failure is an unhealthy worker,
    // but is converted to a 503 response rather than crashing this process.
    eventRepo
      .countByStatus()
      .then((counts) => {
        const body = JSON.stringify({
          status: "ok",
          workerId: state.workerId,
          lastPollAt: state.lastPollAt,
          lastSuccessAt: state.lastSuccessAt,
          queueDepth: {
            pending: counts.pending,
            processing: counts.processing,
            failed: counts.failed,
          },
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(body);
      })
      .catch((err: unknown) => {
        const body = JSON.stringify({
          status: "error",
          workerId: state.workerId,
          lastPollAt: state.lastPollAt,
          lastSuccessAt: state.lastSuccessAt,
          queueDepth: null,
          error: err instanceof Error ? err.message : String(err),
        });
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(body);
      });
  });

  server.listen(port, host, () => {
    logger.info({ host, port }, "worker health server listening");
  });

  return server;
}
