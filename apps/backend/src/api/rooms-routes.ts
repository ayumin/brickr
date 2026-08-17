/**
 * Room lifecycle routes (issues #150, #151, #154, #155, #166, #169).
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
 * Issue #155 adds the visibility-aware room list:
 *   GET    /api/rooms          — list rooms visible to the caller
 * Issue #166 adds room analysis snapshots:
 *   GET    /api/rooms/:id/snapshot  — get the current snapshot (active members)
 *   POST   /api/rooms/:id/snapshot  — generate/update the snapshot (owner/admin)
 * Issue #169 adds join/invite/membership management:
 *   POST   /api/rooms/:id/join                        — join or request to join
 *   POST   /api/rooms/:id/invite                      — invite a user by handle (owner/admin)
 *   GET    /api/rooms/:id/memberships                 — list memberships (owner/admin)
 *   POST   /api/rooms/:id/memberships/:memberId/approve — approve pending (owner/admin)
 *   DELETE /api/rooms/:id/memberships/:memberId        — remove/reject (owner/admin)
 *   POST   /api/rooms/:id/memberships/:memberId/ban    — ban a member (owner/admin)
 *
 * Every route uses `defineRoute` so auth, Zod validation, DomainError mapping,
 * and OpenAPI documentation are all derived from the same definition.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  MEMBER_KINDS,
  MEMBER_ROLES,
  MEMBERSHIP_STATUSES,
  ROOM_VISIBILITIES,
} from "@brickr/shared";
import type { AppServices } from "../services.js";
import { buildOpenApiOperation, defineRoute } from "./define-route.js";
import { RoomForbiddenError } from "../simulation/room-service.js";

export const roomIdParams = z.object({
  id: z.string().trim().min(1).max(64).describe("Room ID"),
});

export const membershipIdParams = z.object({
  id: z.string().trim().min(1).max(64).describe("Room ID"),
  mid: z.string().trim().min(1).max(64).describe("Membership ID"),
});

// ---------------------------------------------------------------------------
// Snapshot response schemas
// ---------------------------------------------------------------------------

const snapshotDtoSchema: z.ZodType = z.lazy(() =>
  z.object({
    id: z.string(),
    roomId: z.string(),
    postCount: z.number().int().min(0),
    latestPostId: z.string().nullable(),
    summary: z.string().nullable(),
    status: z.enum(["pending", "completed", "failed"]),
    error: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    lastSuccessful: snapshotDtoSchema.optional(),
  }),
);

export const snapshotResponseSchema = z.object({
  snapshot: snapshotDtoSchema,
});

export const updateSnapshotResponseSchema = z.object({
  snapshot: snapshotDtoSchema,
  updated: z.boolean(),
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

// The service returns { room: RoomSummaryDto }; the response schema
// mirrors that shape for OpenAPI documentation.
export const roomSummaryResponseSchema = z.object({
  room: roomSummarySchema,
});

const roomDtoResponseSchema = z.object({
  room: roomDtoSchema,
});

// Room list entry: either a full summary or a restricted entry for closed rooms.
const restrictedRoomEntrySchema = z.object({
  restricted: z.literal(true),
  id: z.string(),
  title: z.string().nullable(),
  visibility: z.enum(ROOM_VISIBILITIES),
  createdAt: z.string(),
});

const fullRoomEntrySchema = roomSummarySchema.extend({
  restricted: z.literal(false),
  isMember: z.boolean(),
  pendingCount: z.number().int().min(0).optional(),
});

const roomListEntrySchema = z.discriminatedUnion("restricted", [
  restrictedRoomEntrySchema,
  fullRoomEntrySchema,
]);

export const roomListResponseSchema = z.object({
  rooms: z.array(roomListEntrySchema),
});

// ---------------------------------------------------------------------------
// Membership response schema
// ---------------------------------------------------------------------------

const membershipDtoSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  memberKind: z.enum(MEMBER_KINDS),
  memberId: z.string(),
  role: z.enum(MEMBER_ROLES),
  status: z.enum(MEMBERSHIP_STATUSES),
  invitedById: z.string().optional(),
  invitedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const membershipResponseSchema = z.object({ membership: membershipDtoSchema });
const pendingMembershipsResponseSchema = z.object({
  memberships: z.array(membershipDtoSchema),
});
const membershipsResponseSchema = pendingMembershipsResponseSchema;

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

export const stopRoomOpenApiMeta = {
  operationId: "stopRoom",
  tags: ["Rooms"] as string[],
  summary: "Stop response generation in a room",
  description: "Owner or administrator only.",
  successDescription: "The stopped room",
};

export const resumeRoomOpenApiMeta = {
  operationId: "resumeRoom",
  tags: ["Rooms"] as string[],
  summary: "Resume response generation in a room",
  description: "Owner or administrator only.",
  successDescription: "The resumed room",
};

export const analyzeRoomOpenApiMeta = {
  operationId: "analyzeRoom",
  tags: ["Rooms"] as string[],
  summary: "Analyze posts in a room",
  description: "Owner or administrator only.",
  successDescription: "The room analysis",
};

export const listRoomsOpenApiMeta = {
  operationId: "listRooms",
  tags: ["Simulations"] as string[],
  summary: "List rooms visible to the caller",
  description:
    "Returns the rooms the signed-in user may discover, ordered by most recent activity. " +
    "public/open rooms are visible to all authenticated users. " +
    "closed rooms appear for all authenticated users but non-members receive only " +
    "prescribed metadata (id, title, visibility, createdAt). " +
    "private rooms are only visible to active members. " +
    "Owners receive a pendingCount badge field with the number of pending join requests.",
  successDescription: "The list of visible rooms",
};

export const getRoomSnapshotOpenApiMeta = {
  operationId: "getRoomSnapshot",
  tags: ["Simulations"] as string[],
  summary: "Get the current room analysis snapshot",
  description:
    "Returns the latest analysis snapshot for a room. " +
    "Active members of the room, the owner, and admins may view. " +
    "Non-members of closed/private rooms are refused with 403. " +
    "Returns 404 when no snapshot has been generated yet.",
  successDescription: "The current room analysis snapshot",
  extraResponses: {
    "403": { $ref: "#/components/responses/Forbidden" },
    "404": { $ref: "#/components/responses/NotFound" },
  },
};

export const updateRoomSnapshotOpenApiMeta = {
  operationId: "updateRoomSnapshot",
  tags: ["Simulations"] as string[],
  summary: "Generate or update the room analysis snapshot",
  description:
    "Triggers generation of a new analysis snapshot for a room. " +
    "Only the room owner or an admin may call this endpoint. " +
    "Archived rooms are refused with 409. " +
    "When postCount and latestPostId are unchanged since the last completed snapshot, " +
    "no new snapshot is generated and updated: false is returned.",
  successDescription: "The snapshot and whether it was regenerated",
  extraResponses: {
    "403": { $ref: "#/components/responses/Forbidden" },
    "404": { $ref: "#/components/responses/NotFound" },
    "409": { $ref: "#/components/responses/Conflict" },
  },
};

export const joinRoomOpenApiMeta = {
  operationId: "joinRoom",
  tags: ["Simulations"] as string[],
  summary: "Join or request to join a room",
  description:
    "For public rooms: creates an active membership immediately. " +
    "For open rooms: creates a pending membership awaiting owner approval. " +
    "For closed/private rooms: returns 403 (invitation only). " +
    "Banned members always receive 403. Already-active or pending members receive 409.",
  successDescription: "The created or updated membership",
  extraResponses: {
    "403": { $ref: "#/components/responses/Forbidden" },
    "404": { $ref: "#/components/responses/NotFound" },
    "409": { $ref: "#/components/responses/Conflict" },
  },
};

export const inviteToRoomOpenApiMeta = {
  operationId: "inviteToRoom",
  tags: ["Simulations"] as string[],
  summary: "Invite a user to a room by handle",
  description:
    "Owner/admin only. Creates an active membership for the invited user, " +
    "bypassing the pending flow. Returns 404 if the handle does not exist.",
  successDescription: "The created membership",
  extraResponses: {
    "403": { $ref: "#/components/responses/Forbidden" },
    "404": { $ref: "#/components/responses/NotFound" },
    "409": { $ref: "#/components/responses/Conflict" },
  },
};

export const listMembershipsOpenApiMeta = {
  operationId: "listRoomMemberships",
  tags: ["Simulations"] as string[],
  summary: "List memberships for a room",
  description: "Owner/admin only. Returns all membership records for the room.",
  successDescription: "The list of memberships",
  extraResponses: {
    "403": { $ref: "#/components/responses/Forbidden" },
    "404": { $ref: "#/components/responses/NotFound" },
  },
};

export const approveMembershipOpenApiMeta = {
  operationId: "approveRoomMembershipByMemberId",
  tags: ["Simulations"] as string[],
  summary: "Approve a pending membership",
  description: "Owner/admin only. Transitions a pending membership to active.",
  successDescription: "The approved membership",
  extraResponses: {
    "403": { $ref: "#/components/responses/Forbidden" },
    "404": { $ref: "#/components/responses/NotFound" },
  },
};

export const removeMembershipOpenApiMeta = {
  operationId: "removeRoomMembership",
  tags: ["Simulations"] as string[],
  summary: "Remove or reject a membership",
  description: "Owner/admin only. Sets the membership status to removed.",
  successDescription: "Membership removed",
  extraResponses: {
    "403": { $ref: "#/components/responses/Forbidden" },
    "404": { $ref: "#/components/responses/NotFound" },
  },
};

export const banMemberOpenApiMeta = {
  operationId: "banRoomMemberByMemberId",
  tags: ["Simulations"] as string[],
  summary: "Ban a member from a room",
  description: "Owner/admin only. Sets the membership status to banned. Banned members cannot re-join.",
  successDescription: "Member banned",
  extraResponses: {
    "403": { $ref: "#/components/responses/Forbidden" },
    "404": { $ref: "#/components/responses/NotFound" },
  },
};

// ---------------------------------------------------------------------------
// Params schemas
// ---------------------------------------------------------------------------

const memberIdParams = z.object({
  id: z.string().trim().min(1).max(64).describe("Room ID"),
  memberId: z.string().trim().min(1).max(64).describe("Member user ID"),
});
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
    path: "/api/rooms",
    auth: "required",
    response: roomListResponseSchema,
  },
  listRoomsOpenApiMeta,
);

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
    method: "POST",
    path: "/api/rooms/:id/stop",
    auth: "required",
    params: roomIdParams,
    response: roomDtoResponseSchema,
  },
  stopRoomOpenApiMeta,
);

buildOpenApiOperation(
  {
    method: "POST",
    path: "/api/rooms/:id/resume",
    auth: "required",
    params: roomIdParams,
    response: roomDtoResponseSchema,
  },
  resumeRoomOpenApiMeta,
);

buildOpenApiOperation(
  {
    method: "GET",
    path: "/api/rooms/:id/analysis",
    auth: "required",
    params: roomIdParams,
    response: z.object({ analysis: z.unknown() }),
  },
  analyzeRoomOpenApiMeta,
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
    method: "POST",
    path: "/api/rooms/:id/join",
    auth: "required",
    params: roomIdParams,
    response: membershipResponseSchema,
  },
  joinRoomOpenApiMeta,
);

buildOpenApiOperation(
  {
    method: "POST",
    path: "/api/rooms/:id/invite",
    auth: "required",
    params: roomIdParams,
    body: z.object({ handle: z.string().trim().min(1).max(64) }),
    response: membershipResponseSchema,
  },
  inviteToRoomOpenApiMeta,
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
    method: "GET",
    path: "/api/rooms/:id/memberships",
    auth: "required",
    params: roomIdParams,
    response: membershipsResponseSchema,
  },
  listMembershipsOpenApiMeta,
);

buildOpenApiOperation(
  {
    method: "POST",
    path: "/api/rooms/:id/memberships/:memberId/approve",
    auth: "required",
    params: memberIdParams,
    response: membershipResponseSchema,
  },
  approveMembershipOpenApiMeta,
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
    method: "GET",
    path: "/api/rooms/:id/snapshot",
    auth: "required",
    params: roomIdParams,
    response: snapshotResponseSchema,
  },
  getRoomSnapshotOpenApiMeta,
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

buildOpenApiOperation(
  {
    method: "POST",
    path: "/api/rooms/:id/snapshot",
    auth: "required",
    params: roomIdParams,
    response: updateSnapshotResponseSchema,
  },
  updateRoomSnapshotOpenApiMeta,
);

buildOpenApiOperation(
  {
    method: "DELETE",
    path: "/api/rooms/:id/memberships/:memberId",
    auth: "required",
    params: memberIdParams,
    response: z.object({}),
  },
  removeMembershipOpenApiMeta,
);

buildOpenApiOperation(
  {
    method: "POST",
    path: "/api/rooms/:id/memberships/:memberId/ban",
    auth: "required",
    params: memberIdParams,
    response: z.object({}),
  },
  banMemberOpenApiMeta,
);

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

/**
 * Registers all room lifecycle routes on the given Fastify instance.
 */
export function registerRoomsRoutes(app: FastifyInstance, services: AppServices): void {
  // GET /api/rooms — list rooms visible to the caller (issue #155)
  defineRoute({
    method: "GET",
    path: "/api/rooms",
    auth: "required",
    response: roomListResponseSchema,
    handler: async ({ user }) => {
      const rooms = await services.simulations.listRooms(user);
      return { rooms };
    },
  }).register(app);

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
      const room = await services.rooms.create({
        title: body.title ?? null,
        visibility: body.visibility,
        createdByUserId: user.id,
      });
      return { room };
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
      const room = await services.rooms.update(params.id, body, user);
      return { room };
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
      const room = await services.rooms.archive(params.id, user);
      // Terminate every open SSE stream for this room (§11.1 visibility
      // re-evaluation). Clients reconnect and receive a 404 — the correct
      // answer for a stopped room they cannot read (§10.4).
      services.events.closeRoom(params.id);
      return { room };
    },
  }).register(app);

  // Room lifecycle controls used by the room information panel.
  defineRoute({
    method: "POST",
    path: "/api/rooms/:id/stop",
    auth: "required",
    params: roomIdParams,
    response: roomDtoResponseSchema,
    handler: async ({ user, params }) => ({
      room: await services.simulations.stop(params.id, user),
    }),
  }).register(app);

  defineRoute({
    method: "POST",
    path: "/api/rooms/:id/resume",
    auth: "required",
    params: roomIdParams,
    response: roomDtoResponseSchema,
    handler: async ({ user, params }) => ({
      room: await services.simulations.resume(params.id, user),
    }),
  }).register(app);

  defineRoute({
    method: "GET",
    path: "/api/rooms/:id/analysis",
    auth: "required",
    params: roomIdParams,
    response: z.object({ analysis: z.unknown() }),
    handler: async ({ user, params }) => ({
      analysis: await services.simulationAnalysis.analyze(params.id, user),
    }),
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

  // POST /api/rooms/:id/join — join or request to join a room (issue #169)
  defineRoute({
    method: "POST",
    path: "/api/rooms/:id/join",
    auth: "required",
    params: roomIdParams,
    response: membershipResponseSchema,
    handler: async ({ user, params }) => {
      const membership = await services.rooms.join(params.id, user);
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

  // POST /api/rooms/:id/invite — invite a user by handle (owner/admin, issue #169)
  defineRoute({
    method: "POST",
    path: "/api/rooms/:id/invite",
    auth: "required",
    params: roomIdParams,
    body: z.object({ handle: z.string().trim().min(1).max(64) }),
    response: membershipResponseSchema,
    handler: async ({ user, params, body }) => {
      const membership = await services.rooms.inviteByHandle(params.id, body.handle, user);
      return { membership };
    },
  }).register(app);

  // GET /api/rooms/:id/memberships — list memberships (owner/admin, issue #169)
  defineRoute({
    method: "GET",
    path: "/api/rooms/:id/memberships",
    auth: "required",
    params: roomIdParams,
    response: membershipsResponseSchema,
    handler: async ({ user, params }) => {
      // Only owner/admin may list memberships — enforced by canManage from the service
      const roomResponse = await services.simulations.get(params.id, user);
      if (!roomResponse.room.canManage) {
        throw new RoomForbiddenError(params.id);
      }
      const memberships = await services.rooms.listMemberships(params.id);
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
      if (membership.memberKind === "user") {
        services.events.closeSubscriber(params.id, membership.memberId);
      }
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
      if (membership.memberKind === "user") {
        services.events.closeSubscriber(params.id, membership.memberId);
      }
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

  // GET /api/rooms/:id/snapshot — get the current analysis snapshot (issue #166)
  defineRoute({
    method: "GET",
    path: "/api/rooms/:id/snapshot",
    auth: "required",
    params: roomIdParams,
    response: snapshotResponseSchema,
    handler: async ({ user, params }) => {
      return services.roomAnalysisSnapshot.get(params.id, user);
    },
  }).register(app);

  // POST /api/rooms/:id/snapshot — generate/update the analysis snapshot (issue #166)
  defineRoute({
    method: "POST",
    path: "/api/rooms/:id/snapshot",
    auth: "required",
    params: roomIdParams,
    response: updateSnapshotResponseSchema,
    handler: async ({ user, params }) => {
      return services.roomAnalysisSnapshot.update(params.id, user);
    },
  }).register(app);

  // POST /api/rooms/:id/memberships/:memberId/approve — approve pending (owner/admin, issue #169)
  defineRoute({
    method: "POST",
    path: "/api/rooms/:id/memberships/:memberId/approve",
    auth: "required",
    params: memberIdParams,
    response: membershipResponseSchema,
    handler: async ({ user, params }) => {
      const membership = await services.rooms.approveMembership(params.id, params.memberId, user);
      return { membership };
    },
  }).register(app);

  // DELETE /api/rooms/:id/memberships/:memberId — remove/reject (owner/admin, issue #169)
  defineRoute({
    method: "DELETE",
    path: "/api/rooms/:id/memberships/:memberId",
    auth: "required",
    params: memberIdParams,
    response: z.object({}),
    handler: async ({ user, params, reply }) => {
      await services.rooms.removeMembership(params.id, params.memberId, user);
      services.events.closeSubscriber(params.id, params.memberId);
      return reply.status(204).send();
    },
  }).register(app);

  // POST /api/rooms/:id/memberships/:memberId/ban — ban a member (owner/admin, issue #169)
  defineRoute({
    method: "POST",
    path: "/api/rooms/:id/memberships/:memberId/ban",
    auth: "required",
    params: memberIdParams,
    response: z.object({}),
    handler: async ({ user, params, reply }) => {
      await services.rooms.banMember(params.id, params.memberId, user);
      services.events.closeSubscriber(params.id, params.memberId);
      return reply.status(204).send();
    },
  }).register(app);
}
