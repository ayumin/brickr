import { GLOBAL_SIMULATION_ID } from "@brickr/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { UserAccount } from "../auth/user-account.js";
import type { AppServices } from "../services.js";
import { GlobalSimulationMutationError } from "../simulation/simulation-service.js";
import { registerRoutes } from "./routes.js";

/**
 * The HTTP half of the global-feed protection (§8.2).
 *
 * The service refuses the mutation; this checks that the refusal reaches the
 * caller as a 403 in the usual envelope instead of a 500, and that posting into
 * the feed — the one thing the reserved row exists for — still works.
 *
 * An admin is used on purpose: the row has no creator, so an ownership check
 * alone would let an admin through.
 */
const admin: UserAccount = {
  id: "admin-1",
  handle: "admin",
  displayName: "管理者",
  description: "",
  email: "admin@example.com",
  isAdmin: true,
  status: "active",
  interests: [],
};

function makeServices(): AppServices {
  const refuse = (): never => {
    throw new GlobalSimulationMutationError(GLOBAL_SIMULATION_ID);
  };

  return {
    simulations: {
      rename: refuse,
      stop: refuse,
      resume: refuse,
      submitUserPost: () => Promise.resolve({ id: "p1" }),
    },
    posts: { toDto: () => Promise.resolve({ id: "p1" }) },
    // The create-post response carries the thread as well as the post (§13.4).
    feed: { buildThreadForReader: () => Promise.resolve({ root: { id: "p1" } }) },
    simulationAnalysis: { analyze: refuse },
  } as unknown as AppServices;
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorateRequest("currentUser", null);
  app.addHook("onRequest", async (request) => {
    request.currentUser = admin;
  });
  await registerRoutes(app, makeServices());
  await app.ready();
  return app;
}

describe("global simulation over HTTP (§8.2)", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  const managementRoutes = [
    {
      method: "PUT" as const,
      url: `/api/simulations/${GLOBAL_SIMULATION_ID}`,
      payload: { title: "世界" },
    },
    {
      method: "POST" as const,
      url: `/api/simulations/${GLOBAL_SIMULATION_ID}/stop`,
      payload: undefined,
    },
    {
      method: "POST" as const,
      url: `/api/simulations/${GLOBAL_SIMULATION_ID}/resume`,
      payload: undefined,
    },
    {
      method: "GET" as const,
      url: `/api/simulations/${GLOBAL_SIMULATION_ID}/analysis`,
      payload: undefined,
    },
  ];

  it.each(managementRoutes)(
    "answers 403 for $method $url, even for an admin",
    async ({ method, url, payload }) => {
      const app = await buildApp();
      apps.push(app);

      const response = await app.inject({
        method,
        url,
        ...(payload === undefined ? {} : { payload }),
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: "forbidden" } });
    },
  );

  it("accepts a post into the feed", async () => {
    const app = await buildApp();
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/simulations/${GLOBAL_SIMULATION_ID}/posts`,
      payload: { content: "フィードへの投稿" },
    });

    expect(response.statusCode).toBe(201);
    // The thread travels with the post (§13.4). Without it the feed would have to
    // rebuild the reply preview, the count and capabilities to show your own post,
    // which is the server's feed logic implemented a second time (§11.3).
    expect(response.json()).toMatchObject({
      post: { id: "p1" },
      thread: { root: { id: "p1" } },
    });
  });
});
