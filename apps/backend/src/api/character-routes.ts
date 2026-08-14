import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/auth-context.js";
import type { AppServices } from "../services.js";
import { sendError } from "./errors.js";
import { parseOr400, withDomainErrors } from "./route-helpers.js";
import {
  bulkCreateCharactersSchema,
  bulkDeleteCharactersSchema,
  deleteCharacterQuerySchema,
  idParams,
  importCharactersCsvSchema,
  saveCharacterSchema,
} from "./schemas.js";

export function registerCharacterRoutes(app: FastifyInstance, services: AppServices): void {
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
}
