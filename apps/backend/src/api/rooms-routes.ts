/**
 * Room lifecycle routes (issues #150, #151, #154).
 *
 * Issue #150 introduced the `defineRoute` pattern with `GET /api/rooms/:id`.
 * Issue #151 adds the full lifecycle:
 *   POST   /api/rooms          — create a room (with owner membership)
 *   GET    /api/rooms/:id      — get one room's summary
 *   PUT    /api/rooms/:id      — update title (visibility is immutable)
 *   POST   /api/rooms/:id/archive  — archive a room (owner/admin only)
 *   DELETE /api/rooms/:id      — delete an archived room (owner/admin only)
 * Issue #154 adds membership management:
 *   POST   /api/rooms/:id/members          — invite a user or character
 *   GET    /api/rooms/:id/members/pending  — list pending memberships (owner/admin)
 *   DELETE /api/rooms/:id/members/:mid     — remove a member
 *   POST   /api/rooms/:id/members/:mid/ban    — ban a member
 *   POST   /api/rooms/:id/members/:mid/unban  — unban a member
 *   POST   /api/rooms/:id/members/:mid/approve — approve a pending membership
 *   POST   /api/rooms/:id/members/:mid/reject  — reject a pending membership
 *
 * Every route uses `defineRoute` so auth, Zod validation, DomainError mapping,
 * and OpenAPI documentation are all derived from the same definition.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MEMBER_KINDS, ROOM_VISIBILITIES } from "@brickr/shared";
import type { AppServices } from "../services.js";
import { buildOpenApiOperation, defineRoute } from "./define-route.js";

export const roomIdParams = z.object({
  id: z.string().trim().min(1).max(64).describe("Room ID"),
});

export const membershipIdParams = z.object({
  id: z.string().trim().min(1).max(64).describe("Room ID"),
  mid: z.string().trim().min(1).max(64).describe("Membership ID"),
});

// ---------------------------------------------------------------------------
// Shared response schemas
// ---------------------------------------------------------------------------

const roomDtoSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  status: z.enum(["active", "archived"]),
  visibility: z.enum(ROOM_VISIBILITIES),
  createdAt: z.string(),
  createdByUserId: z.string().optional(),
});

const roomSummarySchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  status: z.enum(["active", "archived"]),
  visibility: z.enum(ROOM_VISIBILITIES),
  createdAt: z.string(),
  createdByUserId: z.string().optional(),
  postCount: z.number().int().min(0),
  lastActivityAt: z.string(),
  creator: z
    .object({ id: z.string(), handle: z.string(), displayName: z.string() })
    .nullable(),
  canManage: z.boolean(),
});

// The service returns { simulation: SimulationSummaryDto }; the response schema
// mirrors that shape for OpenAPI documentation.
export const roomSummaryResponseSchema = z.object({
  simulation: roomSummarySchema,
});

const roomDtoResponseSchema = z.object({
  simulation: roomDtoSchema,
});

// ---------------------------------------------------------------------------
// Membership response schema
// ---------------------------------------------------------------------------

const membershipDtoSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  memberKind: z.enum(MEMBER_KINDS),
  memberId: z.string(),
  role: z.enum(["owner", "member"]),
  status: z.enum(["active", "pending", "left", "removed", "banned"]),
  invitedById: z.string().optional(),
  invitedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const membershipResponseSchema = z.object({ membership: membershipDtoSchema });
const pendingMembershipsResponseSchema = z.object({
  memberships: z.array(membershipDtoSchema),
});

// ---------------------------------------------------------------------------
// Request body schemas
// ---------------------------------------------------------------------------

const createRoomBodySchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  visibility: z.enum(ROOM_VISIBILITIES).optional(),
});

const updateRoomBodySchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    visibility: z.enum(ROOM_VISIBILITIES).optional(),
  })
  .refine((body) => body.title !== undefined || body.visibility !== undefined, {
    message: "title or visibility is required",
  });

const inviteMemberBodySchema = z.object({
  targetId: z.string().trim().min(1).max(64).describe("User or Character ID to invite"),
  targetKind: z.enum(MEMBER_KINDS).describe("Whether the target is a user or character"),
});

// ---------------------------------------------------------------------------
// OpenAPI metadata (named exports so tests can assert registration)
// ---------------------------------------------------------------------------

export const getRoomOpenApiMeta = {
  operationId: "getRoomSummary",
  tags: ["Simulations"] as string[],
  summary: "Get one room's summary",
  description:
    "Requires a session. A stopped room the caller neither created nor administers " +
    "answers 404. Summary-shaped (postCount/creator/canManage) for the room info panel.",
  successDescription: "The room's summary",
  extraResponses: {
    "404": { $ref: "#/components/responses/NotFound" },
  },
};

export const createRoomOpenApiMeta = {
  operationId: "createRoom",
  tags: ["Simulations"] as string[],
  summary: "Create a room",
  description:
    "Creates a room and grants the creator an active owner membership. " +
    "Visibility defaults to `public` and cannot be changed after creation.",
  successDescription: "The created room",
};

export const updateRoomOpenApiMeta = {
  operationId: "updateRoom",
  tags: ["Simulations"] as string[],
  summary: "Update a room's title",
  description:
    "Updates the room title. Only the owner or an admin may update. " +
    "Visibility is immutable after creation — passing it is rejected.",
  successDescription: "The updated room",
  extraResponses: {
    "403": { $ref: "#/components/responses/Forbidden" },
    "404": { $ref: "#/components/responses/NotFound" },
  },
};

export const archiveRoomOpenApiMeta = {
  operationId: "archiveRoom",
  tags: ["Simulations"] as string[],
  summary: "Archive a room",
  description: "Archives a room. Only the owner or an admin may archive.",
  successDescription: "The archived room",
  extraResponses: {
    "403": { $ref: "#/components/responses/Forbidden" },
    "404": { $ref: "#/components/responses/NotFound" },
  },
};

export const deleteRoomOpenApiMeta = {
  operationId: "deleteRoom",
  tags: ["Simulations"] as string[],
  summary: "Delete an archived room",
  description:
    "Hard-deletes an archived room and all its posts. " +
    "Only the owner or an admin may delete. The room must already be archived.",
  successDescription: "Room deleted",
  extraResponses: {
    "403": { $ref: "#/components/responses/Forbidden" },
    "404": { $ref: "#/components/responses/NotFound" },
    "409": { $ref: "#/components/responses/Conflict" },
  },
};

// ---------------------------------------------------------------------------
// Membership route OpenAPI metadata
// ---------------------------------------------------------------------------

export const inviteMemberOpenApiMeta = {
  operationId: "inviteRoomMember",
  tags: ["Simulations"] as string[],
  summary: "Invite a user or character to a room",
  description:
    "Owner/admin only. Creates an active membership for the target. " +
    "Banned members must be unbanned first. Archived rooms reject invitations.",
  successDescription: "The created or updated membership",
  extraResponses: {
    "403": { $ref: "#/components/responses/Forbidden" },
    "404": { $ref: "#/components/responses/NotFound" },
    "409": { $ref: "#/components/responses/Conflict" },
  },
};

export const listPendingMembershipsOpenApiMeta = {
  operationId: "listPendingRoomMemberships",
  tags: ["Simulations"] as string[],
  summary: "List pending membership requests",
  description: "Owner/admin only. Returns all pending membership requests for the room.",
  successDescription: "List of pending memberships",
  extraResponses: {
    "403": { $ref: "#/components/responses/Forbidden" },
    "404": { $ref: "#/components/responses/NotFound" },
  },
};

export const removeRoomMemberOpenApiMeta = {
  operationId: "removeRoomMember",
  tags: ["Simulations"] as string[],
  summary: "Remove a member from a room",
  description:
    "Owner/admin only. Transitions the membership to `removed`. " +
    "The owner's own membership cannot be removed.",
  successDescription: "The updated membership",
  extraResponses: {
    "403": { $ref: "#/components/responses/Forbidden" },
    "404": { $ref: "#/components/responses/NotFound" },
    "409": { $ref: "#/components/responses/Conflict" },
  },
};

export const banRoomMemberOpenApiMeta = {
  operationId: "banRoomMember",
  tags: ["Simulations"] as string[],
  summary: "Ban a member from a room",
  description:
    "Owner/admin only. Transitions the membership to `banned`. " +
    "The owner's own membership cannot be banned.",
  successDescription: "The updated membership",
  extraResponses: {
    "403": { $ref: "#/components/responses/Forbidden" },
    "404": { $ref: "#/components/responses/NotFound" },
    "409": { $ref: "#/components/responses/Conflict" },
  },
};

export const unbanRoomMemberOpenApiMeta = {
  operationId: "unbanRoomMember",
  tags: ["Simulations"] as string[],
  summary: "Unban a member from a room",
  description:
    "Owner/admin only. Transitions the membership from `banned` to `removed`. " +
    "After unbanning, the member may be re-invited.",
  successDescription: "The updated membership",
  extraResponses: {
    "403": { $ref: "#/components/responses/Forbidden" },
    "404": { $ref: "#/components/responses/NotFound" },
    "409": { $ref: "#/components/responses/Conflict" },
  },
};

export const approveRoomMemberOpenApiMeta = {
  operationId: "approveRoomMembership",
  tags: ["Simulations"] as string[],
  summary: "Approve a pending membership request",
  description:
    "Owner/admin only. Transitions the membership from `pending` to `active`.",
  successDescription: "The updated membership",
  extraResponses: {
    "403": { $ref: "#/components/responses/Forbidden" },
    "404": { $ref: "#/components/responses/NotFound" },
    "409": { $ref: "#/components/responses/Conflict" },
  },
};

export const rejectRoomMemberOpenApiMeta = {
  operationId: "rejectRoomMembership",
  tags: ["Simulations"] as string[],
  summary: "Reject a pending membership request",
  description:
    "Owner/admin only. Deletes the pending membership row — no history is kept.",
  successDescription: "Membership rejected",
  extraResponses: {
    "403": { $ref: "#/components/responses/Forbidden" },
    "404": { $ref: "#/components/responses/NotFound" },
    "409": { $ref: "#/components/responses/Conflict" },
  },
};

// ---------------------------------------------------------------------------
// Register OpenAPI operations at module load time
// ---------------------------------------------------------------------------

buildOpenApiOperation(
  {
    method: "GET",
    path: "/api/rooms/:id",
    auth: "required",
    params: roomIdParams,
    response: roomSummaryResponseSchema,
  },
  getRoomOpenApiMeta,
);

buildOpenApiOperation(
  {
    method: "POST",
    path: "/api/rooms",
    auth: "required",
    body: createRoomBodySchema,
    response: roomDtoResponseSchema,
  },
  createRoomOpenApiMeta,
);

buildOpenApiOperation(
  {
    method: "PUT",
    path: "/api/rooms/:id",
    auth: "required",
    params: roomIdParams,
    body: updateRoomBodySchema,
    response: roomDtoResponseSchema,
  },
  updateRoomOpenApiMeta,
);

buildOpenApiOperation(
  {
    method: "POST",
    path: "/api/rooms/:id/archive",
    auth: "required",
    params: roomIdParams,
    response: roomDtoResponseSchema,
  },
  archiveRoomOpenApiMeta,
);

buildOpenApiOperation(
  {
    method: "DELETE",
    path: "/api/rooms/:id",
    auth: "required",
    params: roomIdParams,
    response: z.object({}),
  },
  deleteRoomOpenApiMeta,
);

buildOpenApiOperation(
  {
    method: "POST",
    path: "/api/rooms/:id/members",
    auth: "required",
    params: roomIdParams,
    body: inviteMemberBodySchema,
    response: membershipResponseSchema,
  },
  inviteMemberOpenApiMeta,
);

buildOpenApiOperation(
  {
    method: "GET",
    path: "/api/rooms/:id/members/pending",
    auth: "required",
    params: roomIdParams,
    response: pendingMembershipsResponseSchema,
  },
  listPendingMembershipsOpenApiMeta,
);

buildOpenApiOperation(
  {
    method: "DELETE",
    path: "/api/rooms/:id/members/:mid",
    auth: "required",
    params: membershipIdParams,
    response: membershipResponseSchema,
  },
  removeRoomMemberOpenApiMeta,
);

buildOpenApiOperation(
  {
    method: "POST",
    path: "/api/rooms/:id/members/:mid/ban",
    auth: "required",
    params: membershipIdParams,
    response: membershipResponseSchema,
  },
  banRoomMemberOpenApiMeta,
);

buildOpenApiOperation(
  {
    method: "POST",
    path: "/api/rooms/:id/members/:mid/unban",
    auth: "required",
    params: membershipIdParams,
    response: membershipResponseSchema,
  },
  unbanRoomMemberOpenApiMeta,
);

buildOpenApiOperation(
  {
    method: "POST",
    path: "/api/rooms/:id/members/:mid/approve",
    auth: "required",
    params: membershipIdParams,
    response: membershipResponseSchema,
  },
  approveRoomMemberOpenApiMeta,
);

buildOpenApiOperation(
  {
    method: "POST",
    path: "/api/rooms/:id/members/:mid/reject",
    auth: "required",
    params: membershipIdParams,
    response: z.object({}),
  },
  rejectRoomMemberOpenApiMeta,
);

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

/**
 * Registers all room lifecycle routes on the given Fastify instance.
 */
export function registerRoomsRoutes(app: FastifyInstance, services: AppServices): void {
  // GET /api/rooms/:id — get one room's summary
  defineRoute({
    method: "GET",
    path: "/api/rooms/:id",
    auth: "required",
    params: roomIdParams,
    response: roomSummaryResponseSchema,
    handler: async ({ user, params }) => {
      return services.simulations.get(params.id, user);
    },
  }).register(app);

  // POST /api/rooms — create a room with owner membership
  defineRoute({
    method: "POST",
    path: "/api/rooms",
    auth: "required",
    body: createRoomBodySchema,
    response: roomDtoResponseSchema,
    handler: async ({ user, body }) => {
      const simulation = await services.rooms.create({
        title: body.title ?? null,
        visibility: body.visibility,
        createdByUserId: user.id,
      });
      return { simulation };
    },
  }).register(app);

  // PUT /api/rooms/:id — update room title (visibility immutable)
  defineRoute({
    method: "PUT",
    path: "/api/rooms/:id",
    auth: "required",
    params: roomIdParams,
    body: updateRoomBodySchema,
    response: roomDtoResponseSchema,
    handler: async ({ user, params, body }) => {
      const simulation = await services.rooms.update(params.id, body, user);
      return { simulation };
    },
  }).register(app);

  // POST /api/rooms/:id/archive — archive a room
  defineRoute({
    method: "POST",
    path: "/api/rooms/:id/archive",
    auth: "required",
    params: roomIdParams,
    response: roomDtoResponseSchema,
    handler: async ({ user, params }) => {
      const simulation = await services.rooms.archive(params.id, user);
      return { simulation };
    },
  }).register(app);

  // DELETE /api/rooms/:id — delete an archived room
  defineRoute({
    method: "DELETE",
    path: "/api/rooms/:id",
    auth: "required",
    params: roomIdParams,
    response: z.object({}),
    handler: async ({ user, params, reply }) => {
      await services.rooms.delete(params.id, user);
      return reply.status(204).send();
    },
  }).register(app);

  // ── Membership management (issue #154) ────────────────────────────────────

  // POST /api/rooms/:id/members — invite a user or character
  defineRoute({
    method: "POST",
    path: "/api/rooms/:id/members",
    auth: "required",
    params: roomIdParams,
    body: inviteMemberBodySchema,
    response: membershipResponseSchema,
    handler: async ({ user, params, body }) => {
      const membership = await services.roomMemberships.invite(
        {
          roomId: params.id,
          targetId: body.targetId,
          targetKind: body.targetKind,
          inviterId: user.id,
        },
        user,
      );
      return { membership };
    },
  }).register(app);

  // GET /api/rooms/:id/members/pending — list pending memberships (owner/admin)
  defineRoute({
    method: "GET",
    path: "/api/rooms/:id/members/pending",
    auth: "required",
    params: roomIdParams,
    response: pendingMembershipsResponseSchema,
    handler: async ({ user, params }) => {
      const memberships = await services.roomMemberships.listPending(params.id, user);
      return { memberships };
    },
  }).register(app);

  // DELETE /api/rooms/:id/members/:mid — remove a member
  defineRoute({
    method: "DELETE",
    path: "/api/rooms/:id/members/:mid",
    auth: "required",
    params: membershipIdParams,
    response: membershipResponseSchema,
    handler: async ({ user, params }) => {
      const membership = await services.roomMemberships.remove(params.id, params.mid, user);
      return { membership };
    },
  }).register(app);

  // POST /api/rooms/:id/members/:mid/ban — ban a member
  defineRoute({
    method: "POST",
    path: "/api/rooms/:id/members/:mid/ban",
    auth: "required",
    params: membershipIdParams,
    response: membershipResponseSchema,
    handler: async ({ user, params }) => {
      const membership = await services.roomMemberships.ban(params.id, params.mid, user);
      return { membership };
    },
  }).register(app);

  // POST /api/rooms/:id/members/:mid/unban — unban a member
  defineRoute({
    method: "POST",
    path: "/api/rooms/:id/members/:mid/unban",
    auth: "required",
    params: membershipIdParams,
    response: membershipResponseSchema,
    handler: async ({ user, params }) => {
      const membership = await services.roomMemberships.unban(params.id, params.mid, user);
      return { membership };
    },
  }).register(app);

  // POST /api/rooms/:id/members/:mid/approve — approve a pending membership
  defineRoute({
    method: "POST",
    path: "/api/rooms/:id/members/:mid/approve",
    auth: "required",
    params: membershipIdParams,
    response: membershipResponseSchema,
    handler: async ({ user, params }) => {
      const membership = await services.roomMemberships.approve(params.id, params.mid, user);
      return { membership };
    },
  }).register(app);

  // POST /api/rooms/:id/members/:mid/reject — reject a pending membership
  defineRoute({
    method: "POST",
    path: "/api/rooms/:id/members/:mid/reject",
    auth: "required",
    params: membershipIdParams,
    response: z.object({}),
    handler: async ({ user, params, reply }) => {
      await services.roomMemberships.reject(params.id, params.mid, user);
      return reply.status(204).send();
    },
  }).register(app);
}
