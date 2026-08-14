import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/auth-context.js";
import type { AppServices } from "../services.js";
import { parseOr400, withSimulation } from "./route-helpers.js";
import { createSimulationSchema, updateSimulationSchema } from "./schemas.js";

export function registerSimulationRoutes(app: FastifyInstance, services: AppServices): void {
  app.get("/api/simulations", async () => ({
    simulations: await services.simulations.list(),
  }));

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

  app.get("/api/simulations/:id", async (request, reply) =>
    withSimulation(request, reply, async (id) => services.simulations.get(id)),
  );

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
    return withSimulation(request, reply, async (id) => ({
      simulation: await services.simulations.stop(id, user),
    }));
  });

  app.post("/api/simulations/:id/resume", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    return withSimulation(request, reply, async (id) => ({
      simulation: await services.simulations.resume(id, user),
    }));
  });
}
