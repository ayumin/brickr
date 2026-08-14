import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/auth-context.js";
import type { AppServices } from "../services.js";
import { sendError } from "./errors.js";
import { toFeedReader } from "./feed-reader.js";
import { parseOr400, withDomainErrors, withSimulation } from "./route-helpers.js";
import { feedQuerySchema } from "./schemas.js";

export function registerFeedRoutes(app: FastifyInstance, services: AppServices): void {
  /**
   * Public on purpose (§10.1): a visitor without an account reads the same posts
   * and gets `capabilities` that permit nothing. `filter=mine` is the exception —
   * there is no "mine" without a session, so it answers 401 rather than silently
   * falling back to `all`, which would show a stranger's feed as if it were theirs.
   */
  app.get("/api/feed", async (request, reply) => {
    const query = parseOr400(feedQuerySchema, request.query, reply, "invalid_query", "feed query is invalid");
    if (!query) return reply;

    const filter = query.filter ?? "all";
    if (filter === "mine" && !request.currentUser) {
      return sendError(reply, 401, "unauthenticated", "sign in to see threads about you");
    }

    return withDomainErrors(reply, () =>
      services.feed.getUnifiedFeed({
        reader: request.currentUser ? toFeedReader(request.currentUser) : null,
        filter,
        ...(query.cursor ? { cursor: query.cursor } : {}),
      }),
    );
  });

  /** Login required, and a room the caller may not read answers 404 (§10.2, §10.4). */
  app.get("/api/simulations/:id/feed", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    const query = parseOr400(feedQuerySchema, request.query, reply, "invalid_query", "feed query is invalid");
    if (!query) return reply;

    return withSimulation(request, reply, async (id) =>
      services.feed.getRoomFeed(id, {
        reader: toFeedReader(user),
        filter: query.filter ?? "all",
        ...(query.cursor ? { cursor: query.cursor } : {}),
      }),
    );
  });
}
