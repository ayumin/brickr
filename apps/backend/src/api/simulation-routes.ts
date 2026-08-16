import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/auth-context.js";
import type { AppServices } from "../services.js";
import { parseOr400, withSimulation } from "./route-helpers.js";
import { createSimulationSchema, updateSimulationSchema } from "./schemas.js";

export function registerSimulationRoutes(app: FastifyInstance, services: AppServices): void {
  /**
   * Login required (§10.3). Rooms are not part of the public surface: an anonymous
   * visitor reads the unified feed and nothing else (§5.1), which keeps the
   * surface that has to be audited for leaks down to `/api/feed`.
   */
  app.get("/api/simulations", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    return { simulations: await services.simulations.list(user) };
  });

  app.post("/api/simulations", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    const body = parseOr400(
      createSimulationSchema,
      request.body ?? {},
      reply,
      "invalid_body",
      "title is invalid",
    );
    if (!body) return reply;

    const simulation = await services.simulations.create(body.title ?? null, user.id);
    return reply.status(201).send({ simulation });
  });

  /**
   * Basics only, and login required (§10.4). A stopped room the caller neither
   * created nor administers answers 404, so this cannot be used to find out that
   * somebody else's room exists.
   */
  app.get("/api/simulations/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    return withSimulation(request, reply, async (id) => services.simulations.get(id, user));
  });

  app.put("/api/simulations/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    const body = parseOr400(updateSimulationSchema, request.body, reply, "invalid_body", "title is invalid");
    if (!body) return reply;

    return withSimulation(request, reply, async (id) => ({
      simulation: await services.simulations.rename(id, body.title, user),
    }));
  });

  /** Admin-only or creator-only (§66.6): unlike the simulation itself, the analysis is not public. */
  app.get("/api/simulations/:id/analysis", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    return withSimulation(request, reply, async (id) => ({
      analysis: await services.simulationAnalysis.analyze(id, user),
    }));
  });

  app.post("/api/simulations/:id/stop", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    return withSimulation(request, reply, async (id) => {
      const simulation = await services.simulations.stop(id, user);
      // Terminate every open SSE stream for this room (§11.1 visibility
      // re-evaluation). Clients reconnect and receive a 404 — the correct
      // answer for a stopped room they cannot read (§10.4).
      services.events.closeRoom(id);
      return { simulation };
    });
  });

  app.post("/api/simulations/:id/resume", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    return withSimulation(request, reply, async (id) => ({
      simulation: await services.simulations.resume(id, user),
    }));
  });
}
