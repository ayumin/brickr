import type { SseEvent } from "@enjo/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { AppServices } from "../services.js";
import { SimulationNotFoundError } from "../simulation/simulation-service.js";
import { sendError } from "./errors.js";
import { idParams } from "./schemas.js";

/** Comment frames keep proxies from closing an idle stream. */
const HEARTBEAT_MS = 20_000;

/**
 * Extracts the CORS headers already negotiated for this reply.
 *
 * Whatever `@fastify/cors` decided (allowed origin, credentials, `Vary`) is
 * reused rather than re-derived, so the stream and the REST routes can never
 * disagree about what is allowed.
 */
function crossOriginHeaders(reply: FastifyReply): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const [name, value] of Object.entries(reply.getHeaders())) {
    if (value === undefined) continue;

    const lower = name.toLowerCase();
    if (!lower.startsWith("access-control-") && lower !== "vary") continue;

    headers[name] = Array.isArray(value) ? value.join(", ") : String(value);
  }

  return headers;
}

/**
 * GET /api/simulations/:id/events
 *
 * Server-Sent Events. Each frame carries the event name in `event:` and the
 * event object in `data:`, so the browser can use named listeners.
 */
export function registerEventsRoute(app: FastifyInstance, services: AppServices): void {
  app.get("/api/simulations/:id/events", async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalid_params", "simulation id is invalid");
    }

    const simulationId = params.data.id;
    try {
      await services.simulations.get(simulationId);
    } catch (error) {
      if (error instanceof SimulationNotFoundError) {
        return sendError(reply, 404, "not_found", error.message);
      }
      throw error;
    }

    reply.raw.writeHead(200, {
      // Writing to `reply.raw` bypasses Fastify's header serialisation, so the
      // CORS headers @fastify/cors put on the reply have to be copied across by
      // hand. Without them the browser rejects the EventSource and retries
      // forever, which looks like a permanently broken realtime connection.
      ...crossOriginHeaders(reply),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx and friends buffer streamed responses without this.
      "X-Accel-Buffering": "no",
    });

    const write = (chunk: string): void => {
      if (reply.raw.writableEnded) return;
      reply.raw.write(chunk);
    };

    // Tell the browser not to reconnect too aggressively, then say hello so the
    // client can flip to "connected" immediately.
    write("retry: 3000\n\n");
    write(": connected\n\n");

    const unsubscribe = services.events.subscribe(simulationId, (event: SseEvent) => {
      write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });

    const heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);

    const cleanup = (): void => {
      clearInterval(heartbeat);
      unsubscribe();
    };

    request.raw.on("close", cleanup);
    reply.raw.on("close", cleanup);
    reply.raw.on("error", cleanup);

    // Returning this promise keeps Fastify from finalising the reply. It stays
    // pending until the client disconnects.
    return new Promise<void>((resolve) => {
      request.raw.on("close", () => resolve());
    });
  });
}
