import type { SseEvent } from "@brickr/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireUser } from "../auth/auth-context.js";
import { toPublicEvent } from "../feed/public-events.js";
import type { AppServices } from "../services.js";
import type { EventListener } from "../simulation/event-hub.js";
import { SimulationNotFoundError } from "../simulation/simulation-service.js";
import { sendError } from "./errors.js";
import { toFeedReader } from "./feed-reader.js";
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
 * Turns one subscription into an HTTP stream and keeps it open until the client
 * leaves.
 *
 * `subscribe` is handed a listener rather than being chosen here, so the same
 * plumbing serves the unified feed and a single room.
 */
function streamEvents(
  request: FastifyRequest,
  reply: FastifyReply,
  subscribe: (listener: EventListener) => () => void,
): Promise<void> {
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

  const unsubscribe = subscribe((event) => {
    // The one conversion point (§11.4). Internal events map to nothing and are
    // never written; public events contain notification metadata and target ids.
    const publicEvent: SseEvent | null = toPublicEvent(event);
    if (!publicEvent) return;
    write(
      `id: ${publicEvent.eventId}\nevent: ${publicEvent.type}\ndata: ${JSON.stringify(publicEvent)}\n\n`,
    );
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
}

/**
 * The two event streams (§11.1).
 *
 * Each frame carries the event name in `event:` and the event object in `data:`,
 * so the browser can use named listeners.
 */
export function registerEventsRoute(app: FastifyInstance, services: AppServices): void {
  /**
   * Every simulation's public events, for the unified feed.
   *
   * Authentication is optional, like the feed it belongs to: an anonymous reader
   * watches the same threads appear and receives capabilities that permit nothing.
   */
  app.get("/api/feed/events", async (request, reply) => {
    return streamEvents(
      request,
      reply,
      (listener) => services.events.subscribeAll(listener),
    );
  });

  /**
   * One room's events.
   *
   * A session is required and the room has to be readable (§11.1): without that,
   * subscribing would reveal that a stopped room exists and when it is active,
   * which the equivalent REST read refuses to say (§10.4).
   */
  app.get("/api/simulations/:id/events", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalid_params", "simulation id is invalid");
    }

    const reader = toFeedReader(user);
    const simulationId = params.data.id;

    try {
      await services.feed.assertRoomFeedReadable(simulationId, reader);
    } catch (error) {
      if (error instanceof SimulationNotFoundError) {
        return sendError(reply, 404, "not_found", error.message);
      }
      throw error;
    }

    return streamEvents(
      request,
      reply,
      (listener) => services.events.subscribe(simulationId, listener),
    );
  });
}
