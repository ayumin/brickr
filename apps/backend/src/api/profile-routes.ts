import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/auth-context.js";
import type { AppServices } from "../services.js";
import { parseOr400, withDomainErrors } from "./route-helpers.js";
import { cursorQuery, handleParams } from "./schemas.js";

/**
 * The public profile of whoever holds a handle - a person or an AI cast member,
 * through one route and one DTO (§10.6, §21).
 *
 * Login is required for both. A profile is the one place where "who is this
 * account" is the whole answer, so leaving it open would hand an anonymous
 * caller a way to enumerate the handle namespace, and the unified feed already
 * carries everything a signed-out reader needs (§5.1, §10.8).
 */
export function registerProfileRoutes(app: FastifyInstance, services: AppServices): void {
  app.get("/api/profiles/:handle", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    const params = parseOr400(handleParams, request.params, reply, "invalid_params", "handle is invalid");
    if (!params) return reply;

    return withDomainErrors(reply, async () => ({
      profile: await services.profiles.getProfile(params.handle, user),
    }));
  });

  /** This account's posts across every room, minus the ones this caller may not see. */
  app.get("/api/profiles/:handle/posts", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    const params = parseOr400(handleParams, request.params, reply, "invalid_params", "handle is invalid");
    if (!params) return reply;

    const query = parseOr400(cursorQuery, request.query, reply, "invalid_query", "cursor is invalid");
    if (!query) return reply;

    return withDomainErrors(reply, () =>
      services.profiles.listPosts(params.handle, user, query.cursor),
    );
  });
}
