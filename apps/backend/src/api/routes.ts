import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppServices } from "../services.js";
import {
  CharacterHandleConflictError,
  CharacterNotFoundError,
  ModelProfileNotFoundError,
} from "../characters/character-service.js";
import {
  PostNotFoundError,
  SimulationNotFoundError,
  SimulationStoppedError,
} from "../simulation/simulation-service.js";
import { sendError } from "./errors.js";
import { registerEventsRoute } from "./events-route.js";
import {
  createPostSchema,
  createSimulationSchema,
  idParams,
  saveCharacterSchema,
  saveUserProfileSchema,
} from "./schemas.js";

export async function registerRoutes(
  app: FastifyInstance,
  services: AppServices,
): Promise<void> {
  app.get("/api/health", async () => ({
    status: "ok",
    providers: services.providerRegistry.availableIds(),
  }));

  // -- characters -----------------------------------------------------------

  app.get("/api/characters", async () => ({
    characters: await services.characters.listDtos(),
  }));

  app.get("/api/characters/:id", async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalid_params", "character id is invalid");
    }

    const character = await services.characters.findDto(params.data.id);
    if (!character) {
      return sendError(reply, 404, "not_found", "character not found");
    }
    return { character };
  });

  app.get("/api/characters/:id/config", async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalid_params", "character id is invalid");
    }
    const character = await services.characters.findConfigDto(params.data.id);
    if (!character) return sendError(reply, 404, "not_found", "character not found");
    return { character };
  });

  app.post("/api/characters", async (request, reply) => {
    const body = saveCharacterSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, "invalid_body", "character body is invalid", body.error.issues);
    }
    try {
      const character = await services.characters.create(body.data);
      return reply.status(201).send({ character });
    } catch (error) {
      return handleDomainError(reply, error);
    }
  });

  app.put("/api/characters/:id", async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalid_params", "character id is invalid");
    }
    const body = saveCharacterSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, "invalid_body", "character body is invalid", body.error.issues);
    }
    try {
      return { character: await services.characters.update(params.data.id, body.data) };
    } catch (error) {
      return handleDomainError(reply, error);
    }
  });

  app.get("/api/model-profiles", async () => ({
    modelProfiles: await services.modelProfiles.listDtos(),
  }));

  app.get("/api/user-profile", async () => ({
    profile: await services.userProfile.get(),
  }));

  app.put("/api/user-profile", async (request, reply) => {
    const body = saveUserProfileSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, "invalid_body", "user profile is invalid", body.error.issues);
    }
    return { profile: await services.userProfile.update(body.data) };
  });

  // -- simulations ----------------------------------------------------------

  app.post("/api/simulations", async (request, reply) => {
    const body = createSimulationSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return sendError(reply, 400, "invalid_body", "title is invalid", body.error.issues);
    }

    const simulation = await services.simulations.create(body.data.title ?? null);
    return reply.status(201).send({ simulation });
  });

  app.get("/api/simulations/:id", async (request, reply) =>
    withSimulation(request, reply, async (id) => services.simulations.get(id)),
  );

  app.post("/api/simulations/:id/stop", async (request, reply) =>
    withSimulation(request, reply, async (id) => ({
      simulation: await services.simulations.stop(id),
    })),
  );

  app.post("/api/simulations/:id/resume", async (request, reply) =>
    withSimulation(request, reply, async (id) => ({
      simulation: await services.simulations.resume(id),
    })),
  );

  // -- posts ----------------------------------------------------------------

  app.get("/api/simulations/:id/posts", async (request, reply) =>
    withSimulation(request, reply, async (id) => ({
      posts: await services.posts.listBySimulation(id),
    })),
  );

  app.post("/api/simulations/:id/posts", async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalid_params", "simulation id is invalid");
    }

    const body = createPostSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, "invalid_body", "post body is invalid", body.error.issues);
    }

    try {
      const post = await services.simulations.submitUserPost({
        simulationId: params.data.id,
        content: body.data.content,
        responderIds: body.data.responderIds ?? [],
        replyTo: body.data.replyTo ?? null,
        quoteOf: body.data.quoteOf ?? null,
      });

      return reply.status(201).send({ post: await services.posts.toDto(post) });
    } catch (error) {
      return handleDomainError(reply, error);
    }
  });

  app.get("/api/posts/:id", async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalid_params", "post id is invalid");
    }

    const post = await services.posts.findById(params.data.id);
    if (!post) return sendError(reply, 404, "not_found", "post not found");

    return { post: await services.posts.toDto(post) };
  });

  // -- sse ------------------------------------------------------------------

  registerEventsRoute(app, services);
}

/** Shared param parsing + domain-error mapping for simulation-scoped routes. */
async function withSimulation<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  handler: (id: string) => Promise<T>,
): Promise<T | FastifyReply> {
  const params = idParams.safeParse(request.params);
  if (!params.success) {
    return sendError(reply, 400, "invalid_params", "simulation id is invalid");
  }

  try {
    return await handler(params.data.id);
  } catch (error) {
    return handleDomainError(reply, error);
  }
}

function handleDomainError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof CharacterNotFoundError || error instanceof ModelProfileNotFoundError) {
    return sendError(reply, 404, "not_found", error.message);
  }
  if (error instanceof CharacterHandleConflictError) {
    return sendError(reply, 409, "handle_conflict", error.message);
  }
  if (error instanceof SimulationNotFoundError) {
    return sendError(reply, 404, "not_found", error.message);
  }
  if (error instanceof PostNotFoundError) {
    return sendError(reply, 404, "not_found", error.message);
  }
  if (error instanceof SimulationStoppedError) {
    return sendError(reply, 409, "simulation_stopped", error.message);
  }
  throw error;
}
