import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/auth-context.js";
import type { AppServices } from "../services.js";
import { registerApplicationSettingsRoutes } from "./application-settings-routes.js";
import { registerAuthRoutes } from "./auth-routes.js";
import { registerCharacterRoutes } from "./character-routes.js";
import { registerEventsRoute } from "./events-route.js";
import { registerFeedRoutes } from "./feed-routes.js";
import { registerPostRoutes } from "./post-routes.js";
import { registerProfileRoutes } from "./profile-routes.js";
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

  // -- profiles -------------------------------------------------------------

  /**
   * There is deliberately no `GET /api/handles/:handle` any more (§10.6).
   *
   * It answered with a discriminated union — `{ ownerType: "user" | "character" }`
   * — so resolving any handle stated outright whether it belonged to a person or
   * to an AI. That is the one thing the public surface must never say (§25), and
   * hiding it in the UI would not have helped: the answer was in the response.
   *
   * `/api/profiles/:handle` replaces it, returning the same shape whichever half
   * of the shared namespace holds the handle. `HandleService` went with the route
   * it existed for: the profile service resolves handles through
   * `HandleRepository` directly, and mentions and handle claims never used it.
   */
  registerProfileRoutes(app, services);

  registerApplicationSettingsRoutes(app, services);
  registerCharacterRoutes(app, services);

  /**
   * Login required (§10.7). A model profile names a provider and a model, which is
   * exactly the machinery a public response must not carry: it is needed to create
   * or edit a cast member, and nowhere else.
   */
  app.get("/api/model-profiles", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    return { modelProfiles: await services.modelProfiles.listDtos() };
  });

  registerUserProfileRoutes(app, services);
  registerSimulationRoutes(app, services);
  registerFeedRoutes(app, services);
  registerPostRoutes(app, services);

  // -- sse ------------------------------------------------------------------

  registerEventsRoute(app, services);
}
