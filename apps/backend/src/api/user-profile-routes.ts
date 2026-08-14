import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/auth-context.js";
import type { AppServices } from "../services.js";
import { sendError } from "./errors.js";
import { parseOr400 } from "./route-helpers.js";
import { saveUserProfileSchema } from "./schemas.js";

export function registerUserProfileRoutes(app: FastifyInstance, services: AppServices): void {
  app.get("/api/user-profile", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    const profile = await services.userProfile.get(user.id);
    // A live session whose account has gone is not a server fault.
    if (!profile) return sendError(reply, 404, "not_found", "user profile not found");

    return { profile };
  });

  app.put("/api/user-profile", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    const body = parseOr400(
      saveUserProfileSchema,
      request.body,
      reply,
      "invalid_body",
      "user profile is invalid",
    );
    if (!body) return reply;

    // Always the session user's own id, so one account cannot edit another.
    const profile = await services.userProfile.update(user.id, body);
    // A live session whose account has gone is not a server fault.
    if (!profile) return sendError(reply, 404, "not_found", "user profile not found");
    return { profile };
  });

  /** The signed-in user's own token usage (CLAUDE.md §66.4), for the profile settings screen. */
  app.get("/api/user-profile/token-usage", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    return services.tokenUsage.getDto(user.id);
  });
}
