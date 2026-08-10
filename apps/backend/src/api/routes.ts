import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppServices } from "../services.js";
import { InvalidApplicationSettingError } from "../settings/runtime-settings.js";
import { CharacterCsvError } from "../characters/character-csv.js";
import {
  CharacterGenerationError,
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
  bulkCreateCharactersSchema,
  bulkDeleteCharactersSchema,
  createPostSchema,
  createSimulationSchema,
  deleteCharacterQuerySchema,
  idParams,
  importCharactersCsvSchema,
  saveCharacterSchema,
  saveUserProfileSchema,
  updateApplicationSettingsSchema,
} from "./schemas.js";

export async function registerRoutes(
  app: FastifyInstance,
  services: AppServices,
): Promise<void> {
  app.get("/api/health", async () => ({
    status: "ok",
    providers: services.providerRegistry.availableIds(),
  }));

  app.get("/api/application-settings", async () =>
    services.applicationSettings.get(),
  );

  app.put("/api/application-settings", async (request, reply) => {
    const body = updateApplicationSettingsSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, "invalid_body", "application settings are invalid", body.error.issues);
    }
    try {
      return await services.applicationSettings.update(body.data);
    } catch (error) {
      if (error instanceof InvalidApplicationSettingError) {
        return sendError(reply, 400, "invalid_setting", error.message);
      }
      throw error;
    }
  });

  // -- characters -----------------------------------------------------------

  app.get("/api/characters", async () => ({
    characters: await services.characters.listDtos(),
  }));

  app.get("/api/characters/management", async () => ({
    characters: await services.characters.listManagementDtos(),
  }));

  app.get("/api/characters/export", async () => services.characters.exportCsv());

  app.post(
    "/api/characters/import",
    { bodyLimit: 50 * 1024 * 1024 },
    async (request, reply) => {
      const body = importCharactersCsvSchema.safeParse(request.body);
      if (!body.success) {
        return sendError(reply, 400, "invalid_body", "CSV data is invalid", body.error.issues);
      }
      try {
        return await services.characters.importCsv(body.data.csv);
      } catch (error) {
        return handleDomainError(reply, error);
      }
    },
  );

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

  app.post("/api/characters/bulk-create", async (request, reply) => {
    const body = bulkCreateCharactersSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(
        reply,
        400,
        "invalid_body",
        "character count is invalid",
        body.error.issues,
      );
    }
    const job = services.characters.startCreateMany(body.data.count);
    return reply.status(202).send({ job });
  });

  app.get("/api/character-bulk-jobs/:id", async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalid_params", "job id is invalid");
    }
    const job = services.characters.findBulkCreationJob(params.data.id);
    if (!job) return sendError(reply, 404, "not_found", "bulk creation job not found");
    return { job };
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

  app.delete("/api/characters/:id", async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalid_params", "character id is invalid");
    }
    const query = deleteCharacterQuerySchema.safeParse(request.query);
    if (!query.success) {
      return sendError(reply, 400, "invalid_query", "deletion mode is invalid");
    }
    try {
      return {
        deletedId: await services.characters.delete(
          params.data.id,
          query.data.mode ?? "soft",
        ),
      };
    } catch (error) {
      return handleDomainError(reply, error);
    }
  });

  app.post("/api/characters/:id/restore", async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalid_params", "character id is invalid");
    }
    try {
      return { restoredId: await services.characters.restore(params.data.id) };
    } catch (error) {
      return handleDomainError(reply, error);
    }
  });

  app.post("/api/characters/bulk-delete", async (request, reply) => {
    const body = bulkDeleteCharactersSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(
        reply,
        400,
        "invalid_body",
        "character ids are invalid",
        body.error.issues,
      );
    }
    return {
      deletedIds: await services.characters.deleteMany(
        body.data.ids,
        body.data.mode ?? "soft",
      ),
    };
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
        imageUrl: body.data.imageUrl,
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
  if (error instanceof CharacterGenerationError) {
    return sendError(reply, 502, "character_generation_failed", error.message);
  }
  if (error instanceof CharacterCsvError) {
    return sendError(reply, 400, "invalid_csv", error.message);
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
