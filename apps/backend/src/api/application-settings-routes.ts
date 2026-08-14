import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../auth/auth-context.js";
import type { AppServices } from "../services.js";
import { parseOr400, withDomainErrors } from "./route-helpers.js";
import { updateApplicationSettingsSchema } from "./schemas.js";

export function registerApplicationSettingsRoutes(
  app: FastifyInstance,
  services: AppServices,
): void {
  /** Admin-only (§66.16): exposes whether API keys are configured and lets an override be set. */
  app.get("/api/application-settings", async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    return services.applicationSettings.get();
  });

  app.put("/api/application-settings", async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;

    const body = parseOr400(
      updateApplicationSettingsSchema,
      request.body,
      reply,
      "invalid_body",
      "application settings are invalid",
    );
    if (!body) return reply;

    return withDomainErrors(reply, () => services.applicationSettings.update(body));
  });
}
