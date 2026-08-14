import type { FastifyInstance } from "fastify";
import type { AppServices } from "../services.js";
import { registerApplicationSettingsRoutes } from "./application-settings-routes.js";
import { registerAuthRoutes } from "./auth-routes.js";
import { registerCharacterRoutes } from "./character-routes.js";
import { sendError } from "./errors.js";
import { registerEventsRoute } from "./events-route.js";
import { registerFeedRoutes } from "./feed-routes.js";
import { registerPostRoutes } from "./post-routes.js";
import { parseOr400 } from "./route-helpers.js";
import { handleParams } from "./schemas.js";
import { registerSimulationRoutes } from "./simulation-routes.js";
import { registerUserAdminRoutes } from "./user-admin-routes.js";
import { registerUserProfileRoutes } from "./user-profile-routes.js";

export async function registerRoutes(
  app: FastifyInstance,
  services: AppServices,
): Promise<void> {
  app.get("/api/health", async () => ({
    status: "ok",
    providers: services.providerRegistry.availableIds(),
  }));

  registerAuthRoutes(app, services);
  registerUserAdminRoutes(app, services);

  // -- handles --------------------------------------------------------------

  /**
   * Resolves a handle with no simulation loaded, which is what a direct visit to
   * `/handle` or a reload has to work from (§66.2).
   */
  app.get("/api/handles/:handle", async (request, reply) => {
    const params = parseOr400(handleParams, request.params, reply, "invalid_params", "handle is invalid");
    if (!params) return reply;

    const owner = await services.handles.resolve(params.handle);
    if (!owner) return sendError(reply, 404, "not_found", "handle not found");

    return { owner };
  });

  registerApplicationSettingsRoutes(app, services);
  registerCharacterRoutes(app, services);

  app.get("/api/model-profiles", async () => ({
    modelProfiles: await services.modelProfiles.listDtos(),
  }));

  registerUserProfileRoutes(app, services);
  registerSimulationRoutes(app, services);
  registerFeedRoutes(app, services);
  registerPostRoutes(app, services);

  // -- sse ------------------------------------------------------------------

  registerEventsRoute(app, services);
}
