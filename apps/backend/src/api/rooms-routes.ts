/**
 * Room lifecycle routes (issues #150, #151).
 *
 * Issue #150 introduced the `defineRoute` pattern with `GET /api/rooms/:id`.
 * Issue #151 adds the full lifecycle:
 *   POST   /api/rooms          — create a room (with owner membership)
 *   GET    /api/rooms/:id      — get one room's summary
 *   PUT    /api/rooms/:id      — update title (visibility is immutable)
 *   POST   /api/rooms/:id/archive  — archive a room (owner/admin only)
 *   DELETE /api/rooms/:id      — delete an archived room (owner/admin only)
 *
 * Every route uses `defineRoute` so auth, Zod validation, DomainError mapping,
 * and OpenAPI documentation are all derived from the same definition.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ROOM_VISIBILITIES } from "@brickr/shared";
import type { AppServices } from "../services.js";
import { buildOpenApiOperation, defineRoute } from "./define-route.js";

export const roomIdParams = z.object({
  id: z.string().trim().min(1).max(64).describe("Room ID"),
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
// Request body schemas
// ---------------------------------------------------------------------------

const createRoomBodySchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  visibility: z.enum(ROOM_VISIBILITIES).optional(),
});

const updateRoomBodySchema = z.object({
  title: z.string().trim().min(1).max(120),
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
      const simulation = await services.rooms.update(params.id, { title: body.title }, user);
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
}
