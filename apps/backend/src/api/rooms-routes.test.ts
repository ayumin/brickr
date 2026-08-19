/**
 * Tests for room lifecycle routes (issues #150, #151, #154, #155, #169).
 *
 * Issue #150: GET /api/rooms/:id (defineRoute demo)
 * Issue #151: POST /api/rooms, PUT /api/rooms/:id, POST /api/rooms/:id/archive,
 *             DELETE /api/rooms/:id
 * Issue #154: membership management endpoints
 * Issue #155: GET /api/rooms (visibility-aware room list)
 * Issue #169: POST /api/rooms/:id/join, POST /api/rooms/:id/invite,
 *             GET /api/rooms/:id/memberships,
 *             POST /api/rooms/:id/memberships/:memberId/approve,
 *             DELETE /api/rooms/:id/memberships/:memberId,
 *             POST /api/rooms/:id/memberships/:memberId/ban
 *
 * Verifies for each route:
 *   - auth: "required" → 401 when signed out
 *   - Zod validation → 400 for invalid input
 *   - DomainError → mapped to its HTTP answer
 *   - OpenAPI operation registered in registeredRoutes
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserAccount } from "../auth/user-account.js";
import { DomainError } from "../domain-error.js";
import { appErrorHandler } from "../app-error.js";
import type { AppServices } from "../services.js";
import { registeredRoutes } from "./define-route.js";
import {
  getRoomOpenApiMeta,
  createRoomOpenApiMeta,
  updateRoomOpenApiMeta,
  archiveRoomOpenApiMeta,
  deleteRoomOpenApiMeta,
  listRoomsOpenApiMeta,
  inviteMemberOpenApiMeta,
  listPendingMembershipsOpenApiMeta,
  removeRoomMemberOpenApiMeta,
  banRoomMemberOpenApiMeta,
  unbanRoomMemberOpenApiMeta,
  approveRoomMemberOpenApiMeta,
  rejectRoomMemberOpenApiMeta,
  joinRoomOpenApiMeta,
  inviteToRoomOpenApiMeta,
  listMembershipsOpenApiMeta,
  approveMembershipOpenApiMeta,
  removeMembershipOpenApiMeta,
  banMemberOpenApiMeta,
  registerRoomsRoutes,
} from "./rooms-routes.js";
import type { RoomService } from "../rooms/room-service.js";
import {
  RoomNotFoundError,
  RoomForbiddenError,
  RoomArchivedError,
  RoomNotArchivedError,
  RoomJoinNotAllowedError,
  RoomAlreadyMemberError,
  RoomMemberBannedError,
  UserNotFoundError,
  VisibilityImmutableError,
} from "../rooms/room-service.js";
import type { RoomMembershipService } from "../rooms/room-membership-service.js";
import {
  MembershipNotFoundError,
  MemberAlreadyExistsError,
  MemberBannedError,
  CannotModifyOwnerError,
  InvalidStatusTransitionError,
} from "../rooms/room-membership-service.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const signedInUser: UserAccount = {
  id: "user-1",
  handle: "hanako",
  displayName: "花子",
  description: "",
  email: "hanako@example.com",
  isAdmin: false,
  status: "active",
  interests: [],
};

class RuntimeRoomNotFoundError extends DomainError {
  readonly httpStatus = 404;
  readonly errorCode = "not_found" as const;
}

const roomSummary = {
  id: "room-1",
  title: "テストルーム",
  status: "active" as const,
  visibility: "public" as const,
  createdAt: "2026-08-16T00:00:00.000Z",
  postCount: 5,
  lastActivityAt: "2026-08-16T00:00:00.000Z",
  creator: null,
  canManage: true,
};

const roomDto = {
  id: "room-1",
  title: "テストルーム",
  status: "active" as const,
  visibility: "public" as const,
  createdAt: "2026-08-16T00:00:00.000Z",
  createdByUserId: "user-1",
};

const membershipDto = {
  id: "mem-1",
  roomId: "room-1",
  memberKind: "user" as const,
  memberId: "user-target",
  role: "member" as const,
  status: "active" as const,
  createdAt: "2026-08-16T00:00:00.000Z",
  updatedAt: "2026-08-16T00:00:00.000Z",
};

function makeRoomService(overrides: Partial<RoomService> = {}): RoomService {
  return {
    create: vi.fn(() => Promise.resolve(roomDto)),
    update: vi.fn(() => Promise.resolve(roomDto)),
    archive: vi.fn(() => Promise.resolve({ ...roomDto, status: "archived" as const })),
    delete: vi.fn(() => Promise.resolve()),
    archiveOwnedBy: vi.fn(() => Promise.resolve()),
    listMemberships: vi.fn(() => Promise.resolve([])),
    join: vi.fn(() => Promise.resolve(membershipDto)),
    inviteByHandle: vi.fn(() => Promise.resolve(membershipDto)),
    approveMembership: vi.fn(() => Promise.resolve({ ...membershipDto, status: "active" as const })),
    removeMembership: vi.fn(() => Promise.resolve()),
    banMember: vi.fn(() => Promise.resolve()),
    ...overrides,
  } as unknown as RoomService;
}

function makeRoomMembershipService(
  overrides: Partial<RoomMembershipService> = {},
): RoomMembershipService {
  return {
    invite: vi.fn(() => Promise.resolve(membershipDto)),
    remove: vi.fn(() => Promise.resolve({ ...membershipDto, status: "removed" as const })),
    ban: vi.fn(() => Promise.resolve({ ...membershipDto, status: "banned" as const })),
    unban: vi.fn(() => Promise.resolve({ ...membershipDto, status: "removed" as const })),
    listPending: vi.fn(() => Promise.resolve([{ ...membershipDto, status: "pending" as const }])),
    approve: vi.fn(() => Promise.resolve({ ...membershipDto, status: "active" as const })),
    reject: vi.fn(() => Promise.resolve()),
    ...overrides,
  } as unknown as RoomMembershipService;
}

function makeServices(
  roomRuntimeOverrides: Partial<AppServices["roomRuntime"]> = {},
  roomsOverrides: Partial<RoomService> = {},
  roomMembershipsOverrides: Partial<RoomMembershipService> = {},
): AppServices {
  return {
    roomRuntime: {
      get: () => Promise.resolve({ room: roomSummary }),
      listRooms: () => Promise.resolve([]),
      stop: () => Promise.resolve({ ...roomDto, status: "archived" as const }),
      resume: () => Promise.resolve(roomDto),
      ...roomRuntimeOverrides,
    },
    roomAnalysis: {
      analyze: () => Promise.resolve({ room: roomDto, postCount: 0 }),
    },
    rooms: makeRoomService(roomsOverrides),
    roomMemberships: makeRoomMembershipService(roomMembershipsOverrides),
    events: {
      closeRoom: vi.fn(),
      closeSubscriber: vi.fn(),
    },
  } as unknown as AppServices;
}

async function buildApp(
  currentUser: UserAccount | null,
  services: AppServices = makeServices(),
): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorateRequest("currentUser", null);
  app.addHook("onRequest", async (request) => {
    request.currentUser = currentUser;
  });
  app.setErrorHandler((error, request, reply) => {
    appErrorHandler(error, request, reply);
  });
  registerRoomsRoutes(app, services);
  await app.ready();
  return app;
}

describe("Room API compatibility operations", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it.each([
    ["stop", "archived"],
    ["resume", "active"],
  ] as const)("POST /api/rooms/:id/%s updates lifecycle state", async (action, status) => {
    const app = await buildApp(signedInUser);
    apps.push(app);
    const response = await app.inject({ method: "POST", url: `/api/rooms/room-1/${action}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ room: { id: "room-1", status } });
  });

  it("GET /api/rooms/:id/analysis returns the room analysis", async () => {
    const app = await buildApp(signedInUser);
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/api/rooms/room-1/analysis" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ analysis: { postCount: 0 } });
  });
});

// ── GET /api/rooms/:id ────────────────────────────────────────────────────────

describe("GET /api/rooms/:id", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("answers 401 when signed out", async () => {
    const app = await buildApp(null);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/rooms/room-1" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "unauthenticated" } });
  });

  it("answers 400 for an empty id", async () => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/rooms/%20" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "invalid_params" } });
  });

  it("returns the room summary when signed in", async () => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/rooms/room-1" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ room: roomSummary });
  });

  it("maps a DomainError from the service to its HTTP answer", async () => {
    const services = makeServices({
      get: () => Promise.reject(new RuntimeRoomNotFoundError("room not found")),
    });
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/rooms/missing" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: "not_found", message: "room not found" },
    });
  });

  it("passes the signed-in user to the service", async () => {
    let receivedUser: UserAccount | undefined;
    const services = makeServices({
      get: (_id: string, user: UserAccount) => {
        receivedUser = user;
        return Promise.resolve({ room: roomSummary });
      },
    });
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    await app.inject({ method: "GET", url: "/api/rooms/room-1" });

    expect(receivedUser?.id).toBe(signedInUser.id);
  });
});

// ── POST /api/rooms ───────────────────────────────────────────────────────────

describe("POST /api/rooms", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("answers 401 when signed out", async () => {
    const app = await buildApp(null);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms",
      payload: { title: "新しいルーム" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("creates a room and returns 200 with the room DTO", async () => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms",
      payload: { title: "新しいルーム", visibility: "public" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ room: { id: "room-1" } });
  });

  it("creates a room without a title", async () => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms",
      payload: {},
    });

    expect(response.statusCode).toBe(200);
  });

  it("passes the signed-in user id as createdByUserId", async () => {
    let receivedInput: Parameters<RoomService["create"]>[0] | undefined;
    const services = makeServices(
      {},
      {
        create: (input) => {
          receivedInput = input;
          return Promise.resolve(roomDto);
        },
      },
    );
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    await app.inject({ method: "POST", url: "/api/rooms", payload: {} });

    expect(receivedInput?.createdByUserId).toBe(signedInUser.id);
  });

  it("answers 400 for an invalid visibility value", async () => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms",
      payload: { visibility: "invalid" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "invalid_body" } });
  });
});

// ── PUT /api/rooms/:id ────────────────────────────────────────────────────────

describe("PUT /api/rooms/:id", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("answers 401 when signed out", async () => {
    const app = await buildApp(null);
    apps.push(app);

    const response = await app.inject({
      method: "PUT",
      url: "/api/rooms/room-1",
      payload: { title: "新タイトル" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("updates the room title and returns the updated DTO", async () => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({
      method: "PUT",
      url: "/api/rooms/room-1",
      payload: { title: "新タイトル" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ room: { id: "room-1" } });
  });

  it("answers 400 when title is missing", async () => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({
      method: "PUT",
      url: "/api/rooms/room-1",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "invalid_body" } });
  });

  it("forwards visibility so the service rejects an attempted change", async () => {
    let receivedInput: Parameters<RoomService["update"]>[1] | undefined;
    const services = makeServices({}, {
      update: (_id, input) => {
        receivedInput = input;
        return Promise.reject(new VisibilityImmutableError());
      },
    });
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({
      method: "PUT",
      url: "/api/rooms/room-1",
      payload: { visibility: "closed" },
    });

    expect(receivedInput).toEqual({ visibility: "closed" });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: "visibility_immutable" } });
  });

  it("maps RoomForbiddenError to 403", async () => {
    const services = makeServices(
      {},
      { update: () => Promise.reject(new RoomForbiddenError("room-1")) },
    );
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({
      method: "PUT",
      url: "/api/rooms/room-1",
      payload: { title: "x" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "forbidden" } });
  });

  it("maps RoomNotFoundError to 404", async () => {
    const services = makeServices(
      {},
      { update: () => Promise.reject(new RoomNotFoundError("missing")) },
    );
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({
      method: "PUT",
      url: "/api/rooms/missing",
      payload: { title: "x" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "room_not_found" } });
  });

  it("maps RoomArchivedError to 409", async () => {
    const services = makeServices(
      {},
      { update: () => Promise.reject(new RoomArchivedError("room-1")) },
    );
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({
      method: "PUT",
      url: "/api/rooms/room-1",
      payload: { title: "x" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "room_archived" } });
  });
});

// ── POST /api/rooms/:id/archive ───────────────────────────────────────────────

describe("POST /api/rooms/:id/archive", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("answers 401 when signed out", async () => {
    const app = await buildApp(null);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/archive",
    });

    expect(response.statusCode).toBe(401);
  });

  it("archives the room and returns the archived DTO", async () => {
    const services = makeServices();
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/archive",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ room: { status: "archived" } });
    expect(services.events.closeRoom).toHaveBeenCalledWith("room-1");
  });

  it("maps RoomForbiddenError to 403", async () => {
    const services = makeServices(
      {},
      { archive: () => Promise.reject(new RoomForbiddenError("room-1")) },
    );
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/archive",
    });

    expect(response.statusCode).toBe(403);
  });

  it("maps RoomNotFoundError to 404", async () => {
    const services = makeServices(
      {},
      { archive: () => Promise.reject(new RoomNotFoundError("missing")) },
    );
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/missing/archive",
    });

    expect(response.statusCode).toBe(404);
  });
});

// ── DELETE /api/rooms/:id ─────────────────────────────────────────────────────

describe("DELETE /api/rooms/:id", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("answers 401 when signed out", async () => {
    const app = await buildApp(null);
    apps.push(app);

    const response = await app.inject({ method: "DELETE", url: "/api/rooms/room-1" });

    expect(response.statusCode).toBe(401);
  });

  it("deletes the room and returns 204", async () => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({ method: "DELETE", url: "/api/rooms/room-1" });

    expect(response.statusCode).toBe(204);
  });

  it("maps RoomForbiddenError to 403", async () => {
    const services = makeServices(
      {},
      { delete: () => Promise.reject(new RoomForbiddenError("room-1")) },
    );
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({ method: "DELETE", url: "/api/rooms/room-1" });

    expect(response.statusCode).toBe(403);
  });

  it("maps RoomNotFoundError to 404", async () => {
    const services = makeServices(
      {},
      { delete: () => Promise.reject(new RoomNotFoundError("missing")) },
    );
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({ method: "DELETE", url: "/api/rooms/missing" });

    expect(response.statusCode).toBe(404);
  });

  it("maps RoomNotArchivedError to 409", async () => {
    const services = makeServices(
      {},
      { delete: () => Promise.reject(new RoomNotArchivedError("room-1")) },
    );
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({ method: "DELETE", url: "/api/rooms/room-1" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "room_not_archived" } });
  });
});

// ── POST /api/rooms/:id/members ───────────────────────────────────────────────

describe("POST /api/rooms/:id/members", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("answers 401 when signed out", async () => {
    const app = await buildApp(null);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/members",
      payload: { targetId: "user-target", targetKind: "user" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("invites a member and returns the membership DTO", async () => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/members",
      payload: { targetId: "user-target", targetKind: "user" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ membership: { id: "mem-1", status: "active" } });
  });

  it("answers 400 for missing targetId", async () => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/members",
      payload: { targetKind: "user" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "invalid_body" } });
  });

  it("answers 400 for invalid targetKind", async () => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/members",
      payload: { targetId: "user-target", targetKind: "invalid" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "invalid_body" } });
  });

  it("maps RoomForbiddenError to 403", async () => {
    const services = makeServices({}, {}, {
      invite: () => Promise.reject(new RoomForbiddenError("room-1")),
    });
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/members",
      payload: { targetId: "user-target", targetKind: "user" },
    });

    expect(response.statusCode).toBe(403);
  });

  it("maps RoomArchivedError to 409", async () => {
    const services = makeServices({}, {}, {
      invite: () => Promise.reject(new RoomArchivedError("room-1")),
    });
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/members",
      payload: { targetId: "user-target", targetKind: "user" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "room_archived" } });
  });

  it("maps MemberBannedError to 409", async () => {
    const services = makeServices({}, {}, {
      invite: () => Promise.reject(new MemberBannedError()),
    });
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/members",
      payload: { targetId: "user-target", targetKind: "user" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "member_banned" } });
  });

  it("maps MemberAlreadyExistsError to 409", async () => {
    const services = makeServices({}, {}, {
      invite: () => Promise.reject(new MemberAlreadyExistsError()),
    });
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/members",
      payload: { targetId: "user-target", targetKind: "user" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "member_already_exists" } });
  });
});

// ── GET /api/rooms/:id/members/pending ────────────────────────────────────────

describe("GET /api/rooms/:id/members/pending", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("answers 401 when signed out", async () => {
    const app = await buildApp(null);
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/rooms/room-1/members/pending",
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns pending memberships", async () => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/rooms/room-1/members/pending",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      memberships: [{ id: "mem-1", status: "pending" }],
    });
  });

  it("maps RoomForbiddenError to 403", async () => {
    const services = makeServices({}, {}, {
      listPending: () => Promise.reject(new RoomForbiddenError("room-1")),
    });
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/rooms/room-1/members/pending",
    });

    expect(response.statusCode).toBe(403);
  });
});

// ── DELETE /api/rooms/:id/members/:mid ────────────────────────────────────────

describe("DELETE /api/rooms/:id/members/:mid", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("answers 401 when signed out", async () => {
    const app = await buildApp(null);
    apps.push(app);

    const response = await app.inject({
      method: "DELETE",
      url: "/api/rooms/room-1/members/mem-1",
    });

    expect(response.statusCode).toBe(401);
  });

  it("removes a member and returns the updated membership", async () => {
    const services = makeServices();
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({
      method: "DELETE",
      url: "/api/rooms/room-1/members/mem-1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ membership: { status: "removed" } });
    expect(services.events.closeSubscriber).toHaveBeenCalledWith("room-1", "user-target");
  });

  it("maps CannotModifyOwnerError to 409", async () => {
    const services = makeServices({}, {}, {
      remove: () => Promise.reject(new CannotModifyOwnerError()),
    });
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({
      method: "DELETE",
      url: "/api/rooms/room-1/members/mem-1",
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "cannot_modify_owner" } });
  });

  it("maps MembershipNotFoundError to 404", async () => {
    const services = makeServices({}, {}, {
      remove: () => Promise.reject(new MembershipNotFoundError("mem-1")),
    });
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({
      method: "DELETE",
      url: "/api/rooms/room-1/members/mem-1",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "membership_not_found" } });
  });

  it("maps InvalidStatusTransitionError to 409", async () => {
    const services = makeServices({}, {}, {
      remove: () => Promise.reject(new InvalidStatusTransitionError("banned", "removed")),
    });
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({
      method: "DELETE",
      url: "/api/rooms/room-1/members/mem-1",
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "invalid_status_transition" } });
  });
});

// ── POST /api/rooms/:id/members/:mid/ban ──────────────────────────────────────

describe("POST /api/rooms/:id/members/:mid/ban", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("answers 401 when signed out", async () => {
    const app = await buildApp(null);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/members/mem-1/ban",
    });

    expect(response.statusCode).toBe(401);
  });

  it("bans a member and returns the updated membership", async () => {
    const services = makeServices();
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/members/mem-1/ban",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ membership: { status: "banned" } });
    expect(services.events.closeSubscriber).toHaveBeenCalledWith("room-1", "user-target");
  });

  it("maps CannotModifyOwnerError to 409", async () => {
    const services = makeServices({}, {}, {
      ban: () => Promise.reject(new CannotModifyOwnerError()),
    });
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/members/mem-1/ban",
    });

    expect(response.statusCode).toBe(409);
  });
});

// ── POST /api/rooms/:id/members/:mid/unban ────────────────────────────────────

describe("POST /api/rooms/:id/members/:mid/unban", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("answers 401 when signed out", async () => {
    const app = await buildApp(null);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/members/mem-1/unban",
    });

    expect(response.statusCode).toBe(401);
  });

  it("unbans a member and returns the updated membership", async () => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/members/mem-1/unban",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ membership: { status: "removed" } });
  });

  it("maps InvalidStatusTransitionError to 409", async () => {
    const services = makeServices({}, {}, {
      unban: () => Promise.reject(new InvalidStatusTransitionError("active", "removed (unban)")),
    });
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/members/mem-1/unban",
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "invalid_status_transition" } });
  });
});

// ── POST /api/rooms/:id/members/:mid/approve ──────────────────────────────────

describe("POST /api/rooms/:id/members/:mid/approve", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("answers 401 when signed out", async () => {
    const app = await buildApp(null);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/members/mem-1/approve",
    });

    expect(response.statusCode).toBe(401);
  });

  it("approves a pending membership and returns the updated membership", async () => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/members/mem-1/approve",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ membership: { status: "active" } });
  });

  it("maps InvalidStatusTransitionError to 409", async () => {
    const services = makeServices({}, {}, {
      approve: () => Promise.reject(new InvalidStatusTransitionError("active", "active (approve)")),
    });
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/members/mem-1/approve",
    });

    expect(response.statusCode).toBe(409);
  });
});

// ── POST /api/rooms/:id/members/:mid/reject ───────────────────────────────────

describe("POST /api/rooms/:id/members/:mid/reject", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("answers 401 when signed out", async () => {
    const app = await buildApp(null);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/members/mem-1/reject",
    });

    expect(response.statusCode).toBe(401);
  });

  it("rejects a pending membership and returns 204", async () => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/members/mem-1/reject",
    });

    expect(response.statusCode).toBe(204);
  });

  it("maps MembershipNotFoundError to 404", async () => {
    const services = makeServices({}, {}, {
      reject: () => Promise.reject(new MembershipNotFoundError("mem-1")),
    });
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/members/mem-1/reject",
    });

    expect(response.statusCode).toBe(404);
  });
});

// ── GET /api/rooms ────────────────────────────────────────────────────────────

describe("GET /api/rooms", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("answers 401 when signed out", async () => {
    const app = await buildApp(null);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/rooms" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "unauthenticated" } });
  });

  it("returns an empty list when there are no visible rooms", async () => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/rooms" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ rooms: [] });
  });

  it("returns full room entries for public rooms", async () => {
    const publicRoom = {
      restricted: false as const,
      id: "room-public",
      title: "パブリックルーム",
      status: "active" as const,
      visibility: "public" as const,
      createdAt: "2026-08-16T00:00:00.000Z",
      postCount: 3,
      lastActivityAt: "2026-08-16T00:00:00.000Z",
      creator: null,
      canManage: false,
      isMember: false,
    };
    const services = makeServices({ listRooms: () => Promise.resolve([publicRoom]) });
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/rooms" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ rooms: [publicRoom] });
  });

  it("returns restricted entries for closed rooms where the caller is not a member", async () => {
    const closedRestricted = {
      restricted: true as const,
      id: "room-closed",
      title: "クローズドルーム",
      visibility: "closed" as const,
      createdAt: "2026-08-16T00:00:00.000Z",
    };
    const services = makeServices({ listRooms: () => Promise.resolve([closedRestricted]) });
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/rooms" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.rooms).toHaveLength(1);
    expect(body.rooms[0]).toEqual(closedRestricted);
    expect(body.rooms[0]).not.toHaveProperty("postCount");
    expect(body.rooms[0]).not.toHaveProperty("creator");
    expect(body.rooms[0]).not.toHaveProperty("canManage");
  });

  it("returns pendingCount for the room owner", async () => {
    const ownerRoom = {
      restricted: false as const,
      id: "room-1",
      title: "オーナールーム",
      status: "active" as const,
      visibility: "open" as const,
      createdAt: "2026-08-16T00:00:00.000Z",
      createdByUserId: signedInUser.id,
      postCount: 0,
      lastActivityAt: "2026-08-16T00:00:00.000Z",
      creator: { id: signedInUser.id, handle: "hanako", displayName: "花子" },
      canManage: true,
      isMember: true,
      pendingCount: 3,
    };
    const services = makeServices({ listRooms: () => Promise.resolve([ownerRoom]) });
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/rooms" });

    expect(response.statusCode).toBe(200);
    expect(response.json().rooms[0]).toMatchObject({ pendingCount: 3 });
  });

  it("passes the signed-in user to the service", async () => {
    let receivedUser: UserAccount | undefined;
    const services = makeServices({
      listRooms: (user: UserAccount) => {
        receivedUser = user;
        return Promise.resolve([]);
      },
    });
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    await app.inject({ method: "GET", url: "/api/rooms" });

    expect(receivedUser?.id).toBe(signedInUser.id);
  });
});

// ── OpenAPI registration ──────────────────────────────────────────────────────

describe("rooms route OpenAPI registration", () => {
  it("registers the getRoomSummary operation in registeredRoutes", () => {
    const found = registeredRoutes.find(
      (r) => r.operation.operationId === getRoomOpenApiMeta.operationId,
    );
    expect(found).toBeDefined();
    expect(found?.method).toBe("GET");
    expect(found?.openApiPath).toBe("/api/rooms/{id}");
  });

  it("marks the getRoomSummary operation as session-protected", () => {
    const found = registeredRoutes.find(
      (r) => r.operation.operationId === getRoomOpenApiMeta.operationId,
    );
    expect(found?.operation.security).toEqual([{ cookieAuth: [] }]);
    expect(found?.operation.responses?.["401"]).toBeDefined();
  });

  it("includes the id path parameter in getRoomSummary", () => {
    const found = registeredRoutes.find(
      (r) => r.operation.operationId === getRoomOpenApiMeta.operationId,
    );
    const parameters = found?.operation.parameters as Array<{ name: string; in: string }> | undefined;
    expect(
      parameters?.filter((parameter) => parameter.name === "id" && parameter.in === "path"),
    ).toEqual([expect.objectContaining({ name: "id", in: "path" })]);
  });

  it("registers the createRoom operation", () => {
    const found = registeredRoutes.find(
      (r) => r.operation.operationId === createRoomOpenApiMeta.operationId,
    );
    expect(found).toBeDefined();
    expect(found?.method).toBe("POST");
    expect(found?.openApiPath).toBe("/api/rooms");
  });

  it("registers the updateRoom operation", () => {
    const found = registeredRoutes.find(
      (r) => r.operation.operationId === updateRoomOpenApiMeta.operationId,
    );
    expect(found).toBeDefined();
    expect(found?.method).toBe("PUT");
    expect(found?.openApiPath).toBe("/api/rooms/{id}");
  });

  it("registers the archiveRoom operation", () => {
    const found = registeredRoutes.find(
      (r) => r.operation.operationId === archiveRoomOpenApiMeta.operationId,
    );
    expect(found).toBeDefined();
    expect(found?.method).toBe("POST");
    expect(found?.openApiPath).toBe("/api/rooms/{id}/archive");
  });

  it("registers the deleteRoom operation", () => {
    const found = registeredRoutes.find(
      (r) => r.operation.operationId === deleteRoomOpenApiMeta.operationId,
    );
    expect(found).toBeDefined();
    expect(found?.method).toBe("DELETE");
    expect(found?.openApiPath).toBe("/api/rooms/{id}");
  });

  it("registers the listRooms operation", () => {
    const found = registeredRoutes.find(
      (r) => r.operation.operationId === listRoomsOpenApiMeta.operationId,
    );
    expect(found).toBeDefined();
    expect(found?.method).toBe("GET");
    expect(found?.openApiPath).toBe("/api/rooms");
  });

  it("marks the listRooms operation as session-protected", () => {
    const found = registeredRoutes.find(
      (r) => r.operation.operationId === listRoomsOpenApiMeta.operationId,
    );
    expect(found?.operation.security).toEqual([{ cookieAuth: [] }]);
    expect(found?.operation.responses?.["401"]).toBeDefined();
  });

  it("registers the inviteRoomMember operation", () => {
    const found = registeredRoutes.find(
      (r) => r.operation.operationId === inviteMemberOpenApiMeta.operationId,
    );
    expect(found).toBeDefined();
    expect(found?.method).toBe("POST");
    expect(found?.openApiPath).toBe("/api/rooms/{id}/members");
  });

  it("registers the listPendingRoomMemberships operation", () => {
    const found = registeredRoutes.find(
      (r) => r.operation.operationId === listPendingMembershipsOpenApiMeta.operationId,
    );
    expect(found).toBeDefined();
    expect(found?.method).toBe("GET");
    expect(found?.openApiPath).toBe("/api/rooms/{id}/members/pending");
  });

  it("registers the removeRoomMember operation", () => {
    const found = registeredRoutes.find(
      (r) => r.operation.operationId === removeRoomMemberOpenApiMeta.operationId,
    );
    expect(found).toBeDefined();
    expect(found?.method).toBe("DELETE");
    expect(found?.openApiPath).toBe("/api/rooms/{id}/members/{mid}");
  });

  it("registers the banRoomMember operation", () => {
    const found = registeredRoutes.find(
      (r) => r.operation.operationId === banRoomMemberOpenApiMeta.operationId,
    );
    expect(found).toBeDefined();
    expect(found?.method).toBe("POST");
    expect(found?.openApiPath).toBe("/api/rooms/{id}/members/{mid}/ban");
  });

  it("registers the unbanRoomMember operation", () => {
    const found = registeredRoutes.find(
      (r) => r.operation.operationId === unbanRoomMemberOpenApiMeta.operationId,
    );
    expect(found).toBeDefined();
    expect(found?.method).toBe("POST");
    expect(found?.openApiPath).toBe("/api/rooms/{id}/members/{mid}/unban");
  });

  it("registers the joinRoom operation", () => {
    const found = registeredRoutes.find(
      (r) => r.operation.operationId === joinRoomOpenApiMeta.operationId,
    );
    expect(found).toBeDefined();
    expect(found?.method).toBe("POST");
    expect(found?.openApiPath).toBe("/api/rooms/{id}/join");
  });

  it("registers the inviteToRoom operation", () => {
    const found = registeredRoutes.find(
      (r) => r.operation.operationId === inviteToRoomOpenApiMeta.operationId,
    );
    expect(found).toBeDefined();
    expect(found?.method).toBe("POST");
    expect(found?.openApiPath).toBe("/api/rooms/{id}/invite");
  });

  it("registers the listRoomMemberships operation", () => {
    const found = registeredRoutes.find(
      (r) => r.operation.operationId === listMembershipsOpenApiMeta.operationId,
    );
    expect(found).toBeDefined();
    expect(found?.method).toBe("GET");
    expect(found?.openApiPath).toBe("/api/rooms/{id}/memberships");
  });

  it("registers the approveRoomMembership operation", () => {
    const found = registeredRoutes.find(
      (r) => r.operation.operationId === approveRoomMemberOpenApiMeta.operationId,
    );
    expect(found).toBeDefined();
    expect(found?.method).toBe("POST");
    expect(found?.openApiPath).toBe("/api/rooms/{id}/members/{mid}/approve");
  });

  it("registers the rejectRoomMembership operation", () => {
    const found = registeredRoutes.find(
      (r) => r.operation.operationId === rejectRoomMemberOpenApiMeta.operationId,
    );
    expect(found).toBeDefined();
    expect(found?.method).toBe("POST");
    expect(found?.openApiPath).toBe("/api/rooms/{id}/members/{mid}/reject");
  });
});

describe("room management route OpenAPI registration", () => {
  it("registers the approveRoomMembershipByMemberId operation", () => {
    const found = registeredRoutes.find(
      (r) => r.operation.operationId === approveMembershipOpenApiMeta.operationId,
    );
    expect(found).toBeDefined();
    expect(found?.method).toBe("POST");
    expect(found?.openApiPath).toBe("/api/rooms/{id}/memberships/{memberId}/approve");
  });

  it("registers the removeRoomMembership operation", () => {
    const found = registeredRoutes.find(
      (r) => r.operation.operationId === removeMembershipOpenApiMeta.operationId,
    );
    expect(found).toBeDefined();
    expect(found?.method).toBe("DELETE");
    expect(found?.openApiPath).toBe("/api/rooms/{id}/memberships/{memberId}");
  });

  it("registers the banRoomMember operation", () => {
    const found = registeredRoutes.find(
      (r) => r.operation.operationId === banMemberOpenApiMeta.operationId,
    );
    expect(found).toBeDefined();
    expect(found?.method).toBe("POST");
    expect(found?.openApiPath).toBe("/api/rooms/{id}/memberships/{memberId}/ban");
  });
});

// ── POST /api/rooms/:id/join ──────────────────────────────────────────────────

describe("POST /api/rooms/:id/join", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("answers 401 when signed out", async () => {
    const app = await buildApp(null);
    apps.push(app);

    const response = await app.inject({ method: "POST", url: "/api/rooms/room-1/join" });

    expect(response.statusCode).toBe(401);
  });

  it("joins the room and returns the membership", async () => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({ method: "POST", url: "/api/rooms/room-1/join" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ membership: { id: "mem-1", status: "active" } });
  });

  it("maps RoomJoinNotAllowedError to 403", async () => {
    const services = makeServices(
      {},
      { join: () => Promise.reject(new RoomJoinNotAllowedError("room-1")) },
    );
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({ method: "POST", url: "/api/rooms/room-1/join" });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "room_join_not_allowed" } });
  });

  it("maps RoomAlreadyMemberError to 409", async () => {
    const services = makeServices(
      {},
      { join: () => Promise.reject(new RoomAlreadyMemberError("room-1")) },
    );
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({ method: "POST", url: "/api/rooms/room-1/join" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "room_already_member" } });
  });

  it("maps RoomMemberBannedError to 403", async () => {
    const services = makeServices(
      {},
      { join: () => Promise.reject(new RoomMemberBannedError("room-1")) },
    );
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({ method: "POST", url: "/api/rooms/room-1/join" });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "room_member_banned" } });
  });
});

// ── POST /api/rooms/:id/invite ────────────────────────────────────────────────

describe("POST /api/rooms/:id/invite", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("answers 401 when signed out", async () => {
    const app = await buildApp(null);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/invite",
      payload: { handle: "someuser" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("invites a user and returns the membership", async () => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/invite",
      payload: { handle: "someuser" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ membership: { id: "mem-1" } });
  });

  it("answers 400 when handle is missing", async () => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/invite",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "invalid_body" } });
  });

  it("maps RoomForbiddenError to 403", async () => {
    const services = makeServices(
      {},
      { inviteByHandle: () => Promise.reject(new RoomForbiddenError("room-1")) },
    );
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/invite",
      payload: { handle: "someuser" },
    });

    expect(response.statusCode).toBe(403);
  });

  it("maps UserNotFoundError to 404", async () => {
    const services = makeServices(
      {},
      { inviteByHandle: () => Promise.reject(new UserNotFoundError("nobody")) },
    );
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/invite",
      payload: { handle: "nobody" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "user_not_found" } });
  });
});

// ── GET /api/rooms/:id/memberships ────────────────────────────────────────────

describe("GET /api/rooms/:id/memberships", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("answers 401 when signed out", async () => {
    const app = await buildApp(null);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/rooms/room-1/memberships" });

    expect(response.statusCode).toBe(401);
  });

  it("returns memberships for the room owner", async () => {
    const services = makeServices(
      { get: () => Promise.resolve({ room: { ...roomSummary, canManage: true } }) },
      { listMemberships: () => Promise.resolve([membershipDto]) },
    );
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/rooms/room-1/memberships" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ memberships: [{ id: "mem-1" }] });
  });

  it("answers 403 for a non-owner", async () => {
    const services = makeServices({
      get: () => Promise.resolve({ room: { ...roomSummary, canManage: false } }),
    });
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/rooms/room-1/memberships" });

    expect(response.statusCode).toBe(403);
  });
});

// ── POST /api/rooms/:id/memberships/:memberId/approve ─────────────────────────

describe("POST /api/rooms/:id/memberships/:memberId/approve", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("answers 401 when signed out", async () => {
    const app = await buildApp(null);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/memberships/user-2/approve",
    });

    expect(response.statusCode).toBe(401);
  });

  it("approves the membership and returns it", async () => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/memberships/user-2/approve",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ membership: { status: "active" } });
  });

  it("maps RoomForbiddenError to 403", async () => {
    const services = makeServices(
      {},
      { approveMembership: () => Promise.reject(new RoomForbiddenError("room-1")) },
    );
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/memberships/user-2/approve",
    });

    expect(response.statusCode).toBe(403);
  });
});

// ── DELETE /api/rooms/:id/memberships/:memberId ───────────────────────────────

describe("DELETE /api/rooms/:id/memberships/:memberId", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("answers 401 when signed out", async () => {
    const app = await buildApp(null);
    apps.push(app);

    const response = await app.inject({
      method: "DELETE",
      url: "/api/rooms/room-1/memberships/user-2",
    });

    expect(response.statusCode).toBe(401);
  });

  it("removes the membership and returns 204", async () => {
    const services = makeServices();
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({
      method: "DELETE",
      url: "/api/rooms/room-1/memberships/user-2",
    });

    expect(response.statusCode).toBe(204);
    expect(services.events.closeSubscriber).toHaveBeenCalledWith("room-1", "user-2");
  });

  it("maps RoomForbiddenError to 403", async () => {
    const services = makeServices(
      {},
      { removeMembership: () => Promise.reject(new RoomForbiddenError("room-1")) },
    );
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({
      method: "DELETE",
      url: "/api/rooms/room-1/memberships/user-2",
    });

    expect(response.statusCode).toBe(403);
  });
});

// ── POST /api/rooms/:id/memberships/:memberId/ban ─────────────────────────────

describe("POST /api/rooms/:id/memberships/:memberId/ban", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("answers 401 when signed out", async () => {
    const app = await buildApp(null);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/memberships/user-2/ban",
    });

    expect(response.statusCode).toBe(401);
  });

  it("bans the member and returns 204", async () => {
    const services = makeServices();
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/memberships/user-2/ban",
    });

    expect(response.statusCode).toBe(204);
    expect(services.events.closeSubscriber).toHaveBeenCalledWith("room-1", "user-2");
  });

  it("maps RoomForbiddenError to 403", async () => {
    const services = makeServices(
      {},
      { banMember: () => Promise.reject(new RoomForbiddenError("room-1")) },
    );
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/memberships/user-2/ban",
    });

    expect(response.statusCode).toBe(403);
  });
});
