import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  AccountSuspendedError,
  EmailTakenError,
  HandleTakenError,
  InvalidBirthdateError,
  InvalidCredentialsError,
  InviteCodeInvalidError,
  UnderageSignupError,
} from "../auth/auth-errors.js";
import { requireAdmin, requireUser } from "../auth/auth-context.js";
import type { IssuedSession } from "../auth/auth-service.js";
import {
  readSessionCookie,
  serializeClearedSessionCookie,
  serializeSessionCookie,
  type SessionCookieOptions,
} from "../auth/session-cookie.js";
import { toAuthUserDto } from "../auth/user-account.js";
import { env } from "../config/env.js";
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
  handleParams,
  idParams,
  importCharactersCsvSchema,
  loginSchema,
  signupSchema,
  saveCharacterSchema,
  saveUserProfileSchema,
  updateApplicationSettingsSchema,
  updateSimulationSchema,
} from "./schemas.js";

export async function registerRoutes(
  app: FastifyInstance,
  services: AppServices,
): Promise<void> {
  app.get("/api/health", async () => ({
    status: "ok",
    providers: services.providerRegistry.availableIds(),
  }));

  // -- auth -----------------------------------------------------------------

  const cookieOptions: SessionCookieOptions = {
    secure: env.auth.cookieSecure,
    maxAgeSeconds: Math.floor(env.auth.sessionTtlMs / 1000),
  };

  /** Lets the frontend boot without guessing: `null` simply means signed out. */
  app.get("/api/auth/session", async (request) => ({
    user: request.currentUser ? toAuthUserDto(request.currentUser) : null,
  }));

  app.post("/api/auth/signup", async (request, reply) => {
    const body = signupSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, "invalid_body", "signup body is invalid", body.error.issues);
    }
    try {
      const issued = await services.auth.signup(body.data);
      return replyWithSession(reply, issued, cookieOptions).status(201).send({
        user: toAuthUserDto(issued.user),
      });
    } catch (error) {
      return handleDomainError(reply, error);
    }
  });

  app.post("/api/auth/login", async (request, reply) => {
    const body = loginSchema.safeParse(request.body);
    if (!body.success) {
      // Generic on purpose: a validation error must not reveal which field is wrong.
      return sendError(reply, 401, "invalid_credentials", "email or password is incorrect");
    }
    try {
      const issued = await services.auth.login(body.data);
      return replyWithSession(reply, issued, cookieOptions).send({
        user: toAuthUserDto(issued.user),
      });
    } catch (error) {
      return handleDomainError(reply, error);
    }
  });

  /** Idempotent: signing out without a session is a success, not a 401. */
  app.post("/api/auth/logout", async (request, reply) => {
    await services.auth.logout(readSessionCookie(request.headers.cookie));
    return reply
      .header("set-cookie", serializeClearedSessionCookie(cookieOptions))
      .send({ user: null });
  });

  // -- handles --------------------------------------------------------------

  /**
   * Resolves a handle with no simulation loaded, which is what a direct visit to
   * `/handle` or a reload has to work from (§66.2).
   */
  app.get("/api/handles/:handle", async (request, reply) => {
    const params = handleParams.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalid_params", "handle is invalid");
    }

    const owner = await services.handles.resolve(params.data.handle);
    if (!owner) return sendError(reply, 404, "not_found", "handle not found");

    return { owner };
  });

  /** Admin-only (§66.16): exposes whether API keys are configured and lets an override be set. */
  app.get("/api/application-settings", async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    return services.applicationSettings.get();
  });

  app.put("/api/application-settings", async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;

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
    {
      bodyLimit: 50 * 1024 * 1024,
      onRequest: async (request, reply) => {
        requireUser(request, reply);
      },
    },
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
    if (!requireUser(request, reply)) return reply;

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
    if (!requireUser(request, reply)) return reply;

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
    if (!requireUser(request, reply)) return reply;

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
    if (!requireUser(request, reply)) return reply;

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
    if (!requireUser(request, reply)) return reply;

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
    if (!requireUser(request, reply)) return reply;

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

    const body = saveUserProfileSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, "invalid_body", "user profile is invalid", body.error.issues);
    }
    // Always the session user's own id, so one account cannot edit another.
    const profile = await services.userProfile.update(user.id, body.data);
    // A live session whose account has gone is not a server fault.
    if (!profile) return sendError(reply, 404, "not_found", "user profile not found");
    return { profile };
  });

  // -- simulations ----------------------------------------------------------

  app.get("/api/simulations", async () => ({
    simulations: await services.simulations.list(),
  }));

  app.post("/api/simulations", async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

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

  app.put("/api/simulations/:id", async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const body = updateSimulationSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, "invalid_body", "title is invalid", body.error.issues);
    }
    return withSimulation(request, reply, async (id) => ({
      simulation: await services.simulations.rename(id, body.data.title),
    }));
  });

  app.get("/api/simulations/:id/analysis", async (request, reply) =>
    withSimulation(request, reply, async (id) => ({
      analysis: await services.simulationAnalysis.analyze(id),
    })),
  );

  app.post("/api/simulations/:id/stop", async (request, reply) => {
    if (!requireUser(request, reply)) return reply;
    return withSimulation(request, reply, async (id) => ({
      simulation: await services.simulations.stop(id),
    }));
  });

  app.post("/api/simulations/:id/resume", async (request, reply) => {
    if (!requireUser(request, reply)) return reply;
    return withSimulation(request, reply, async (id) => ({
      simulation: await services.simulations.resume(id),
    }));
  });

  // -- posts ----------------------------------------------------------------

  app.get("/api/simulations/:id/posts", async (request, reply) =>
    withSimulation(request, reply, async (id) => ({
      posts: await services.posts.listBySimulation(id),
    })),
  );

  app.post("/api/simulations/:id/posts", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

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
        authorId: user.id,
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

function replyWithSession(
  reply: FastifyReply,
  issued: IssuedSession,
  options: SessionCookieOptions,
): FastifyReply {
  return reply.header("set-cookie", serializeSessionCookie(issued.token, options));
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
  if (error instanceof InvalidCredentialsError) {
    return sendError(reply, 401, "invalid_credentials", error.message);
  }
  if (error instanceof AccountSuspendedError) {
    return sendError(reply, 403, "account_suspended", error.message);
  }
  if (error instanceof InviteCodeInvalidError) {
    return sendError(reply, 400, "invalid_invite_code", error.message);
  }
  if (error instanceof UnderageSignupError) {
    return sendError(reply, 400, "underage", error.message);
  }
  if (error instanceof InvalidBirthdateError) {
    return sendError(reply, 400, "invalid_birthdate", error.message);
  }
  if (error instanceof HandleTakenError) {
    return sendError(reply, 409, "handle_conflict", error.message);
  }
  if (error instanceof EmailTakenError) {
    return sendError(reply, 409, "email_conflict", error.message);
  }
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
