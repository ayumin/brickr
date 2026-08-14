import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../auth/auth-context.js";
import { toInviteCodeDto } from "../auth/invite-code.js";
import { toUserManagementDto } from "../auth/user-account.js";
import type { AppServices } from "../services.js";
import { sendError } from "./errors.js";
import { parseOr400, withDomainErrors } from "./route-helpers.js";
import { createInviteCodeSchema, idParams, userManagementQuerySchema } from "./schemas.js";

export function registerUserAdminRoutes(app: FastifyInstance, services: AppServices): void {
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
}
