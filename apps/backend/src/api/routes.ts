import type { FastifyInstance, FastifyReply } from "fastify";
import { requireAdmin, requireUser } from "../auth/auth-context.js";
import type { IssuedSession } from "../auth/auth-service.js";
import { toInviteCodeDto } from "../auth/invite-code.js";
import {
  readSessionCookie,
  serializeClearedSessionCookie,
  serializeSessionCookie,
  type SessionCookieOptions,
} from "../auth/session-cookie.js";
import { toAuthUserDto, toUserManagementDto } from "../auth/user-account.js";
import { env } from "../config/env.js";
import type { AppServices } from "../services.js";
import { sendError } from "./errors.js";
import { registerEventsRoute } from "./events-route.js";
import { toFeedReader } from "./feed-reader.js";
import { parseOr400, withDomainErrors, withSimulation } from "./route-helpers.js";
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
    const body = parseOr400(signupSchema, request.body, reply, "invalid_body", "signup body is invalid");
    if (!body) return reply;

    return withDomainErrors(reply, async () => {
      const issued = await services.auth.signup(body);
      return replyWithSession(reply, issued, cookieOptions).status(201).send({
        user: toAuthUserDto(issued.user),
      });
    });
  });

  app.post("/api/auth/login", async (request, reply) => {
    const body = loginSchema.safeParse(request.body);
    if (!body.success) {
      // Generic on purpose: a validation error must not reveal which field is wrong.
      return sendError(reply, 401, "invalid_credentials", "email or password is incorrect");
    }
    return withDomainErrors(reply, async () => {
      const issued = await services.auth.login(body.data);
      return replyWithSession(reply, issued, cookieOptions).send({
        user: toAuthUserDto(issued.user),
      });
    });
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

    const query = parseOr400(
      userManagementQuerySchema,
      request.query,
      reply,
      "invalid_query",
      "query is invalid",
    );
    if (!query) return reply;

    const page = await services.userAdmin.listManagement({
      page: query.page ?? 1,
      ...(query.search ? { search: query.search } : {}),
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

    const params = parseOr400(idParams, request.params, reply, "invalid_params", "user id is invalid");
    if (!params) return reply;

    const user = await services.userAdmin.findById(params.id);
    if (!user) return sendError(reply, 404, "not_found", "user not found");
    return { user: toUserManagementDto(user) };
  });

  app.post("/api/users/:id/suspend", async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;

    const params = parseOr400(idParams, request.params, reply, "invalid_params", "user id is invalid");
    if (!params) return reply;

    return withDomainErrors(reply, async () => {
      const user = await services.userAdmin.suspend(params.id);
      return { user: toUserManagementDto(user) };
    });
  });

  app.post("/api/users/:id/reactivate", async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;

    const params = parseOr400(idParams, request.params, reply, "invalid_params", "user id is invalid");
    if (!params) return reply;

    return withDomainErrors(reply, async () => {
      const user = await services.userAdmin.reactivate(params.id);
      return { user: toUserManagementDto(user) };
    });
  });

  /** Returns the temporary password once, in clear text, for the admin to relay (§66.10). */
  app.post("/api/users/:id/reset-password", async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;

    const params = parseOr400(idParams, request.params, reply, "invalid_params", "user id is invalid");
    if (!params) return reply;

    return withDomainErrors(reply, async () => {
      const { temporaryPassword } = await services.userAdmin.resetPassword(params.id);
      return { temporaryPassword };
    });
  });

  app.get("/api/users/:id/characters", async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return reply;

    const params = parseOr400(idParams, request.params, reply, "invalid_params", "user id is invalid");
    if (!params) return reply;

    const user = await services.userAdmin.findById(params.id);
    if (!user) return sendError(reply, 404, "not_found", "user not found");
    return {
      characters: await services.characters.listManagementDtosByCreator(params.id, admin),
    };
  });

  app.get("/api/users/:id/token-usage", async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;

    const params = parseOr400(idParams, request.params, reply, "invalid_params", "user id is invalid");
    if (!params) return reply;

    const user = await services.userAdmin.findById(params.id);
    if (!user) return sendError(reply, 404, "not_found", "user not found");
    return services.tokenUsage.getDto(params.id);
  });

  // -- invite codes -----------------------------------------------------------

  /** Admin-only (§66.9, §66.15): signup itself validates and burns the code, in AuthService.signup. */
  app.post("/api/invite-codes", async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return reply;

    // The whole body is optional (OpenAPI marks it so), so an omitted body must
    // parse the same as `{}` rather than fail validation.
    const body = parseOr400(
      createInviteCodeSchema,
      request.body ?? {},
      reply,
      "invalid_body",
      "invite code request is invalid",
    );
    if (!body) return reply;

    const inviteCode = await services.inviteCodes.issue(admin.id, body);
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
    const params = parseOr400(handleParams, request.params, reply, "invalid_params", "handle is invalid");
    if (!params) return reply;

    const owner = await services.handles.resolve(params.handle);
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
      const body = parseOr400(
        importCharactersCsvSchema,
        request.body,
        reply,
        "invalid_body",
        "CSV data is invalid",
      );
      if (!body) return reply;

      return withDomainErrors(reply, () => services.characters.importCsv(body.csv));
    },
  );

  app.get("/api/characters/:id", async (request, reply) => {
    const params = parseOr400(idParams, request.params, reply, "invalid_params", "character id is invalid");
    if (!params) return reply;

    const character = await services.characters.findDto(params.id);
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
    const params = parseOr400(idParams, request.params, reply, "invalid_params", "character id is invalid");
    if (!params) return reply;

    const character = await services.characters.findConfigDto(params.id, request.currentUser);
    if (!character) return sendError(reply, 404, "not_found", "character not found");
    return { character };
  });

  app.post("/api/characters", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    const body = parseOr400(
      saveCharacterSchema,
      request.body,
      reply,
      "invalid_body",
      "character body is invalid",
    );
    if (!body) return reply;

    return withDomainErrors(reply, async () => {
      const character = await services.characters.create(body, user);
      return reply.status(201).send({ character });
    });
  });

  app.post("/api/characters/bulk-create", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    const body = parseOr400(
      bulkCreateCharactersSchema,
      request.body,
      reply,
      "invalid_body",
      "character count is invalid",
    );
    if (!body) return reply;

    const job = services.characters.startCreateMany(body.count, user.id);
    return reply.status(202).send({ job });
  });

  app.get("/api/character-bulk-jobs/:id", async (request, reply) => {
    const params = parseOr400(idParams, request.params, reply, "invalid_params", "job id is invalid");
    if (!params) return reply;

    const job = services.characters.findBulkCreationJob(params.id);
    if (!job) return sendError(reply, 404, "not_found", "bulk creation job not found");
    return { job };
  });

  app.put("/api/characters/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    const params = parseOr400(idParams, request.params, reply, "invalid_params", "character id is invalid");
    if (!params) return reply;
    const body = parseOr400(
      saveCharacterSchema,
      request.body,
      reply,
      "invalid_body",
      "character body is invalid",
    );
    if (!body) return reply;

    return withDomainErrors(reply, async () => ({
      character: await services.characters.update(params.id, body, user),
    }));
  });

  app.delete("/api/characters/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    const params = parseOr400(idParams, request.params, reply, "invalid_params", "character id is invalid");
    if (!params) return reply;
    const query = parseOr400(
      deleteCharacterQuerySchema,
      request.query,
      reply,
      "invalid_query",
      "deletion mode is invalid",
    );
    if (!query) return reply;

    return withDomainErrors(reply, async () => ({
      deletedId: await services.characters.delete(params.id, user, query.mode ?? "soft"),
    }));
  });

  app.post("/api/characters/:id/restore", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    const params = parseOr400(idParams, request.params, reply, "invalid_params", "character id is invalid");
    if (!params) return reply;

    return withDomainErrors(reply, async () => ({
      restoredId: await services.characters.restore(params.id, user),
    }));
  });

  app.post("/api/characters/bulk-delete", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    const body = parseOr400(
      bulkDeleteCharactersSchema,
      request.body,
      reply,
      "invalid_body",
      "character ids are invalid",
    );
    if (!body) return reply;

    return {
      deletedIds: await services.characters.deleteMany(body.ids, user, body.mode ?? "soft"),
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

    const body = parseOr400(
      saveUserProfileSchema,
      request.body,
      reply,
      "invalid_body",
      "user profile is invalid",
    );
    if (!body) return reply;

    // Always the session user's own id, so one account cannot edit another.
    const profile = await services.userProfile.update(user.id, body);
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

  // -- feed -----------------------------------------------------------------

  /**
   * Public on purpose (§10.1): a visitor without an account reads the same posts
   * and gets `capabilities` that permit nothing. `filter=mine` is the exception —
   * there is no "mine" without a session, so it answers 401 rather than silently
   * falling back to `all`, which would show a stranger's feed as if it were theirs.
   */
  app.get("/api/feed", async (request, reply) => {
    const query = parseOr400(feedQuerySchema, request.query, reply, "invalid_query", "feed query is invalid");
    if (!query) return reply;

    const filter = query.filter ?? "all";
    if (filter === "mine" && !request.currentUser) {
      return sendError(reply, 401, "unauthenticated", "sign in to see threads about you");
    }

    return withDomainErrors(reply, () =>
      services.feed.getUnifiedFeed({
        reader: request.currentUser ? toFeedReader(request.currentUser) : null,
        filter,
        ...(query.cursor ? { cursor: query.cursor } : {}),
      }),
    );
  });

  /** Login required, and a room the caller may not read answers 404 (§10.2, §10.4). */
  app.get("/api/simulations/:id/feed", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    const query = parseOr400(feedQuerySchema, request.query, reply, "invalid_query", "feed query is invalid");
    if (!query) return reply;

    return withSimulation(request, reply, async (id) =>
      services.feed.getRoomFeed(id, {
        reader: toFeedReader(user),
        filter: query.filter ?? "all",
        ...(query.cursor ? { cursor: query.cursor } : {}),
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

    const params = parseOr400(idParams, request.params, reply, "invalid_params", "simulation id is invalid");
    if (!params) return reply;

    const body = parseOr400(createPostSchema, request.body, reply, "invalid_body", "post body is invalid");
    if (!body) return reply;

    return withDomainErrors(reply, async () => {
      const post = await services.simulations.submitUserPost({
        simulationId: params.id,
        authorId: user.id,
        content: body.content,
        imageUrl: body.imageUrl,
        responderIds: body.responderIds ?? [],
        replyTo: body.replyTo ?? null,
        quoteOf: body.quoteOf ?? null,
      });

      return reply.status(201).send({ post: await services.posts.toDto(post) });
    });
  });

  app.get("/api/posts/:id", async (request, reply) => {
    const params = parseOr400(idParams, request.params, reply, "invalid_params", "post id is invalid");
    if (!params) return reply;

    const post = await services.posts.findById(params.id);
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

    const params = parseOr400(
      threadRootParams,
      request.params,
      reply,
      "invalid_params",
      "thread root id is invalid",
    );
    if (!params) return reply;

    return withDomainErrors(reply, async () => ({
      posts: await services.feed.listThreadReplies(params.threadRootId, toFeedReader(user)),
    }));
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
