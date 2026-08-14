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
  /**
   * Every route here requires a session and answers within the caller's
   * management scope: their own characters, or all of them for an administrator
   * (§10.7).
   *
   * That is more than access control. A complete character list is a table
   * mapping handles to "this one is an AI", which would undo the anonymity the
   * whole feed rests on (§25), so it must not be obtainable through any of these
   * endpoints by someone not already entitled to manage the rows in it.
   */
  app.get("/api/characters", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    return { characters: await services.characters.listDtos(user) };
  });

  app.get("/api/characters/management", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    return { characters: await services.characters.listManagementDtos(user) };
  });

  app.get("/api/characters/export", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    return services.characters.exportCsv(user);
  });

  app.post(
    "/api/characters/import",
    { bodyLimit: 50 * 1024 * 1024 },
    async (request, reply) => {
      // Guarded in the handler rather than in `onRequest`, because the import needs
      // the caller itself: every matched row is checked for ownership against it.
      const user = requireUser(request, reply);
      if (!user) return reply;

      const body = parseOr400(
        importCharactersCsvSchema,
        request.body,
        reply,
        "invalid_body",
        "CSV data is invalid",
      );
      if (!body) return reply;

      return withDomainErrors(reply, () => services.characters.importCsv(body.csv, user));
    },
  );

  app.get("/api/characters/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    const params = parseOr400(idParams, request.params, reply, "invalid_params", "character id is invalid");
    if (!params) return reply;

    const character = await services.characters.findDto(params.id, user);
    if (!character) {
      return sendError(reply, 404, "not_found", "character not found");
    }
    return { character };
  });

  /**
   * The creator or an administrator only (§10.7): this is the one response that
   * carries the model profile and the persona, and neither may ever be reachable
   * from a public profile.
   *
   * A character the caller may not have answers 404 rather than 403. A 403 would
   * confirm that the id belongs to a character, and that single bit is enough to
   * sort accounts into people and AI (§25).
   */
  app.get("/api/characters/:id/config", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    const params = parseOr400(idParams, request.params, reply, "invalid_params", "character id is invalid");
    if (!params) return reply;

    const character = await services.characters.findConfigDto(params.id, user);
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

  /** Login required like the bulk creation it reports on (§10.7). */
  app.get("/api/character-bulk-jobs/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

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
