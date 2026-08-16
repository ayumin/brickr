/**
 * Tests for room lifecycle routes (issues #150, #151).
 *
 * Issue #150: GET /api/rooms/:id (defineRoute demo)
 * Issue #151: POST /api/rooms, PUT /api/rooms/:id, POST /api/rooms/:id/archive,
 *             DELETE /api/rooms/:id
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
  registerRoomsRoutes,
} from "./rooms-routes.js";
import type { RoomService } from "../simulation/room-service.js";
import {
  RoomNotFoundError,
  RoomForbiddenError,
  RoomArchivedError,
  RoomNotArchivedError,
} from "../simulation/room-service.js";

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

class SimulationNotFoundError extends DomainError {
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

function makeRoomService(overrides: Partial<RoomService> = {}): RoomService {
  return {
    create: vi.fn(() => Promise.resolve(roomDto)),
    update: vi.fn(() => Promise.resolve(roomDto)),
    archive: vi.fn(() => Promise.resolve({ ...roomDto, status: "archived" as const })),
    delete: vi.fn(() => Promise.resolve()),
    archiveOwnedBy: vi.fn(() => Promise.resolve()),
    listMemberships: vi.fn(() => Promise.resolve([])),
    ...overrides,
  } as unknown as RoomService;
}

function makeServices(
  simulationsOverrides: Partial<AppServices["simulations"]> = {},
  roomsOverrides: Partial<RoomService> = {},
): AppServices {
  return {
    simulations: {
      get: () => Promise.resolve({ simulation: roomSummary }),
      ...simulationsOverrides,
    },
    rooms: makeRoomService(roomsOverrides),
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
    expect(response.json()).toEqual({ simulation: roomSummary });
  });

  it("maps a DomainError from the service to its HTTP answer", async () => {
    const services = makeServices({
      get: () => Promise.reject(new SimulationNotFoundError("room not found")),
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
        return Promise.resolve({ simulation: roomSummary });
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
    expect(response.json()).toMatchObject({ simulation: { id: "room-1" } });
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
    expect(response.json()).toMatchObject({ simulation: { id: "room-1" } });
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
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/archive",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ simulation: { status: "archived" } });
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
});
