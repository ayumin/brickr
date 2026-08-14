import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  AccountSuspendedError,
  EmailTakenError,
  HandleTakenError,
  InvalidBirthdateError,
  InvalidCredentialsError,
  InviteCodeInvalidError,
  UnderageSignupError,
  UserNotFoundError,
} from "../auth/auth-errors.js";
import { requireAdmin, requireUser } from "../auth/auth-context.js";
import type { IssuedSession } from "../auth/auth-service.js";
import { toInviteCodeDto } from "../auth/invite-code.js";
import {
  readSessionCookie,
  serializeClearedSessionCookie,
  serializeSessionCookie,
  type SessionCookieOptions,
} from "../auth/session-cookie.js";
import { toAuthUserDto, toUserManagementDto, type UserAccount } from "../auth/user-account.js";
import { env } from "../config/env.js";
import type { AppServices } from "../services.js";
import { InvalidApplicationSettingError } from "../settings/runtime-settings.js";
import { CharacterCsvError } from "../characters/character-csv.js";
import {
  CharacterForbiddenError,
  CharacterGenerationError,
  CharacterHandleConflictError,
  CharacterNotFoundError,
  ModelProfileNotFoundError,
} from "../characters/character-service.js";
import { FeedCursorInvalidError } from "../feed/feed-cursor.js";
import type { FeedReader } from "../feed/feed-service.js";
import { ReplyTargetNotFoundError } from "../posts/post-repository.js";
import {
  GlobalSimulationMutationError,
  PostNotFoundError,
  SimulationForbiddenError,
  SimulationNotFoundError,
  SimulationStoppedError,
} from "../simulation/simulation-service.js";
import { sendError } from "./errors.js";
import { registerEventsRoute } from "./events-route.js";
import {
  bulkCreateCharactersSchema,
  bulkDeleteCharactersSchema,
  createInviteCodeSchema,
  createPostSchema,
  createSimulationSchema,
  deleteCharacterQuerySchema,
  feedQuerySchema,
  handleParams,
  idParams,
  importCharactersCsvSchema,
  loginSchema,
  signupSchema,
  saveCharacterSchema,
  saveUserProfileSchema,
  threadRootParams,
  updateApplicationSettingsSchema,
  updateSimulationSchema,
  userManagementQuerySchema,
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

  // -- users (admin) ----------------------------------------------------------

  /**
   * All routes below act on somebody else's account, so every one of them is
   * gated to admins only (§66.7, §66.15) — never just `requireUser`.
   */

  app.get("/api/users/management", async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;

    const query = userManagementQuerySchema.safeParse(request.query);
    if (!query.success) {
      return sendError(reply, 400, "invalid_query", "query is invalid", query.error.issues);
    }

    const page = await services.userAdmin.listManagement({
      page: query.data.page ?? 1,
      ...(query.data.search ? { search: query.data.search } : {}),
    });
    return {
      users: page.accounts.map(toUserManagementDto),
      page: page.page,
      pageSize: page.pageSize,
      totalCount: page.totalCount,
    };
  });

  app.get("/api/users/:id", async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;

    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalid_params", "user id is invalid");
    }

    const user = await services.userAdmin.findById(params.data.id);
    if (!user) return sendError(reply, 404, "not_found", "user not found");
    return { user: toUserManagementDto(user) };
  });

  app.post("/api/users/:id/suspend", async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;

    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalid_params", "user id is invalid");
    }
    try {
      const user = await services.userAdmin.suspend(params.data.id);
      return { user: toUserManagementDto(user) };
    } catch (error) {
      return handleDomainError(reply, error);
    }
  });

  app.post("/api/users/:id/reactivate", async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;

    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalid_params", "user id is invalid");
    }
    try {
      const user = await services.userAdmin.reactivate(params.data.id);
      return { user: toUserManagementDto(user) };
    } catch (error) {
      return handleDomainError(reply, error);
    }
  });

  /** Returns the temporary password once, in clear text, for the admin to relay (§66.10). */
  app.post("/api/users/:id/reset-password", async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;

    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalid_params", "user id is invalid");
    }
    try {
      const { temporaryPassword } = await services.userAdmin.resetPassword(params.data.id);
      return { temporaryPassword };
    } catch (error) {
      return handleDomainError(reply, error);
    }
  });

  app.get("/api/users/:id/characters", async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return reply;

    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalid_params", "user id is invalid");
    }
    const user = await services.userAdmin.findById(params.data.id);
    if (!user) return sendError(reply, 404, "not_found", "user not found");
    return {
      characters: await services.characters.listManagementDtosByCreator(params.data.id, admin),
    };
  });

  app.get("/api/users/:id/token-usage", async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;

    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalid_params", "user id is invalid");
    }
    const user = await services.userAdmin.findById(params.data.id);
    if (!user) return sendError(reply, 404, "not_found", "user not found");
    return services.tokenUsage.getDto(params.data.id);
  });

  // -- invite codes -----------------------------------------------------------

  /** Admin-only (§66.9, §66.15): signup itself validates and burns the code, in AuthService.signup. */
  app.post("/api/invite-codes", async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return reply;

    // The whole body is optional (OpenAPI marks it so), so an omitted body must
    // parse the same as `{}` rather than fail validation.
    const body = createInviteCodeSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return sendError(reply, 400, "invalid_body", "invite code request is invalid", body.error.issues);
    }
    const inviteCode = await services.inviteCodes.issue(admin.id, body.data);
    return reply.status(201).send({ inviteCode: toInviteCodeDto(inviteCode) });
  });

  app.get("/api/invite-codes", async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;

    const inviteCodes = await services.inviteCodes.list();
    return { inviteCodes: inviteCodes.map((inviteCode) => toInviteCodeDto(inviteCode)) };
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

  app.get("/api/characters/management", async (request) => ({
    characters: await services.characters.listManagementDtos(request.currentUser),
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

  /**
   * Public read, but the auth hook still resolves `currentUser` (possibly
   * null), which is enough to decide whether `createdByUserId` may ride along
   * (§66.5) without gating the whole endpoint behind a session.
   */
  app.get("/api/characters/:id/config", async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalid_params", "character id is invalid");
    }
    const character = await services.characters.findConfigDto(
      params.data.id,
      request.currentUser,
    );
    if (!character) return sendError(reply, 404, "not_found", "character not found");
    return { character };
  });

  app.post("/api/characters", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    const body = saveCharacterSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, "invalid_body", "character body is invalid", body.error.issues);
    }
    try {
      const character = await services.characters.create(body.data, user);
      return reply.status(201).send({ character });
    } catch (error) {
      return handleDomainError(reply, error);
    }
  });

  app.post("/api/characters/bulk-create", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

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
    const job = services.characters.startCreateMany(body.data.count, user.id);
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
    const user = requireUser(request, reply);
    if (!user) return reply;

    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalid_params", "character id is invalid");
    }
    const body = saveCharacterSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, "invalid_body", "character body is invalid", body.error.issues);
    }
    try {
      return { character: await services.characters.update(params.data.id, body.data, user) };
    } catch (error) {
      return handleDomainError(reply, error);
    }
  });

  app.delete("/api/characters/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

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
          user,
          query.data.mode ?? "soft",
        ),
      };
    } catch (error) {
      return handleDomainError(reply, error);
    }
  });

  app.post("/api/characters/:id/restore", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalid_params", "character id is invalid");
    }
    try {
      return { restoredId: await services.characters.restore(params.data.id, user) };
    } catch (error) {
      return handleDomainError(reply, error);
    }
  });

  app.post("/api/characters/bulk-delete", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

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
        user,
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

  /** The signed-in user's own token usage (CLAUDE.md §66.4), for the profile settings screen. */
  app.get("/api/user-profile/token-usage", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    return services.tokenUsage.getDto(user.id);
  });

  // -- simulations ----------------------------------------------------------

  app.get("/api/simulations", async () => ({
    simulations: await services.simulations.list(),
  }));

  app.post("/api/simulations", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    const body = createSimulationSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return sendError(reply, 400, "invalid_body", "title is invalid", body.error.issues);
    }

    const simulation = await services.simulations.create(body.data.title ?? null, user.id);
    return reply.status(201).send({ simulation });
  });

  app.get("/api/simulations/:id", async (request, reply) =>
    withSimulation(request, reply, async (id) => services.simulations.get(id)),
  );

  app.put("/api/simulations/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    const body = updateSimulationSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, "invalid_body", "title is invalid", body.error.issues);
    }
    return withSimulation(request, reply, async (id) => ({
      simulation: await services.simulations.rename(id, body.data.title, user),
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

  // -- feed -----------------------------------------------------------------

  /**
   * Public on purpose (§10.1): a visitor without an account reads the same posts
   * and gets `capabilities` that permit nothing. `filter=mine` is the exception —
   * there is no "mine" without a session, so it answers 401 rather than silently
   * falling back to `all`, which would show a stranger's feed as if it were theirs.
   */
  app.get("/api/feed", async (request, reply) => {
    const query = feedQuerySchema.safeParse(request.query);
    if (!query.success) {
      return sendError(reply, 400, "invalid_query", "feed query is invalid", query.error.issues);
    }

    const filter = query.data.filter ?? "all";
    if (filter === "mine" && !request.currentUser) {
      return sendError(reply, 401, "unauthenticated", "sign in to see threads about you");
    }

    try {
      return await services.feed.getUnifiedFeed({
        reader: request.currentUser ? toFeedReader(request.currentUser) : null,
        filter,
        ...(query.data.cursor ? { cursor: query.data.cursor } : {}),
      });
    } catch (error) {
      return handleDomainError(reply, error);
    }
  });

  /** Login required, and a room the caller may not read answers 404 (§10.2, §10.4). */
  app.get("/api/simulations/:id/feed", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    const query = feedQuerySchema.safeParse(request.query);
    if (!query.success) {
      return sendError(reply, 400, "invalid_query", "feed query is invalid", query.error.issues);
    }

    return withSimulation(request, reply, async (id) =>
      services.feed.getRoomFeed(id, {
        reader: toFeedReader(user),
        filter: query.data.filter ?? "all",
        ...(query.data.cursor ? { cursor: query.data.cursor } : {}),
      }),
    );
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

  /**
   * The replies the feed left out (§12.2). Login required, like the thread detail
   * it belongs to: the feed's own preview is all an anonymous reader gets (§10.8).
   */
  app.get("/api/posts/:threadRootId/replies", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    const params = threadRootParams.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalid_params", "thread root id is invalid");
    }

    try {
      return {
        posts: await services.feed.listThreadReplies(params.data.threadRootId, toFeedReader(user)),
      };
    } catch (error) {
      return handleDomainError(reply, error);
    }
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

/**
 * The signed-in reader as the feed sees them: an id, an admin flag and a handle,
 * the last one because `filter=mine` matches mentions by handle (§12.3).
 */
function toFeedReader(user: UserAccount): NonNullable<FeedReader> {
  return { id: user.id, isAdmin: user.isAdmin, handle: user.handle };
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
  if (error instanceof UserNotFoundError) {
    return sendError(reply, 404, "not_found", error.message);
  }
  if (error instanceof CharacterNotFoundError || error instanceof ModelProfileNotFoundError) {
    return sendError(reply, 404, "not_found", error.message);
  }
  if (
    error instanceof CharacterForbiddenError ||
    error instanceof SimulationForbiddenError ||
    // Managing the global feed as if it were a room: refused for everyone,
    // admins included (§8.2).
    error instanceof GlobalSimulationMutationError
  ) {
    return sendError(reply, 403, "forbidden", error.message);
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
  if (error instanceof PostNotFoundError || error instanceof ReplyTargetNotFoundError) {
    return sendError(reply, 404, "not_found", error.message);
  }
  if (error instanceof SimulationStoppedError) {
    return sendError(reply, 409, "simulation_stopped", error.message);
  }
  // A cursor we did not issue, or one we can no longer read (§9.4). Answered
  // rather than ignored: serving page one would look like a feed that silently
  // lost the reader's place.
  if (error instanceof FeedCursorInvalidError) {
    return sendError(reply, 400, "invalid_cursor", error.message);
  }
  throw error;
}
