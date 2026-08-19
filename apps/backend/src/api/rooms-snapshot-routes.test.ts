/**
 * Tests for room analysis snapshot routes (issue #166).
 *
 * GET  /api/rooms/:id/snapshot — get the current snapshot
 * POST /api/rooms/:id/snapshot — generate/update the snapshot
 *
 * Verifies:
 *   - auth: "required" → 401 when signed out
 *   - Zod validation → 400 for invalid params
 *   - DomainError → mapped to its HTTP answer
 *   - OpenAPI operations registered in registeredRoutes
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserAccount } from "../auth/user-account.js";
import { appErrorHandler } from "../app-error.js";
import type { AppServices } from "../services.js";
import { registeredRoutes } from "./define-route.js";
import {
  getRoomSnapshotOpenApiMeta,
  updateRoomSnapshotOpenApiMeta,
  registerRoomsRoutes,
} from "./rooms-routes.js";
import type { RoomAnalysisSnapshotService } from "../rooms/room-analysis-snapshot-service.js";
import {
  SnapshotForbiddenError,
  SnapshotNotFoundError,
  SnapshotRoomArchivedError,
  SnapshotRoomNotFoundError,
} from "../rooms/room-analysis-snapshot-service.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

const snapshotDto = {
  id: "snap-1",
  roomId: "room-1",
  postCount: 3,
  latestPostId: "post-3",
  summary: JSON.stringify({ overallTopics: "話題", postOverview: "概要", highEngagementTopics: "高", lowEngagementTopics: "低" }),
  status: "completed" as const,
  error: null,
  createdAt: "2026-08-16T00:00:00.000Z",
  updatedAt: "2026-08-16T00:00:00.000Z",
};

function makeSnapshotService(
  overrides: Partial<RoomAnalysisSnapshotService> = {},
): RoomAnalysisSnapshotService {
  return {
    get: vi.fn(() => Promise.resolve({ snapshot: snapshotDto })),
    update: vi.fn(() => Promise.resolve({ snapshot: snapshotDto, updated: true })),
    ...overrides,
  } as unknown as RoomAnalysisSnapshotService;
}

function makeServices(
  snapshotOverrides: Partial<RoomAnalysisSnapshotService> = {},
): AppServices {
  return {
    roomRuntime: {
      get: () => Promise.resolve({ room: {} }),
      listRooms: () => Promise.resolve([]),
    },
    rooms: {
      create: vi.fn(() => Promise.resolve({})),
      update: vi.fn(() => Promise.resolve({})),
      archive: vi.fn(() => Promise.resolve({})),
      delete: vi.fn(() => Promise.resolve()),
      archiveOwnedBy: vi.fn(() => Promise.resolve()),
      listMemberships: vi.fn(() => Promise.resolve([])),
    },
    roomAnalysisSnapshot: makeSnapshotService(snapshotOverrides),
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

// ---------------------------------------------------------------------------
// GET /api/rooms/:id/snapshot
// ---------------------------------------------------------------------------

describe("GET /api/rooms/:id/snapshot", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("answers 401 when signed out", async () => {
    const app = await buildApp(null);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/rooms/room-1/snapshot" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "unauthenticated" } });
  });

  it("answers 400 for an empty room id", async () => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/rooms/%20/snapshot" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "invalid_params" } });
  });

  it("returns the snapshot when signed in", async () => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/rooms/room-1/snapshot" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ snapshot: snapshotDto });
  });

  it("passes the signed-in user to the service", async () => {
    let receivedUser: UserAccount | undefined;
    const services = makeServices({
      get: (_id: string, user: UserAccount) => {
        receivedUser = user;
        return Promise.resolve({ snapshot: snapshotDto });
      },
    });
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    await app.inject({ method: "GET", url: "/api/rooms/room-1/snapshot" });

    expect(receivedUser?.id).toBe(signedInUser.id);
  });

  it("maps SnapshotForbiddenError to 403", async () => {
    const services = makeServices({
      get: () => Promise.reject(new SnapshotForbiddenError("room-1")),
    });
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/rooms/room-1/snapshot" });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "forbidden" } });
  });

  it("maps SnapshotNotFoundError to 404", async () => {
    const services = makeServices({
      get: () => Promise.reject(new SnapshotNotFoundError("room-1")),
    });
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/rooms/room-1/snapshot" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "snapshot_not_found" } });
  });

  it("maps SnapshotRoomNotFoundError to 404", async () => {
    const services = makeServices({
      get: () => Promise.reject(new SnapshotRoomNotFoundError("missing")),
    });
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/rooms/missing/snapshot" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "room_not_found" } });
  });
});

// ---------------------------------------------------------------------------
// POST /api/rooms/:id/snapshot
// ---------------------------------------------------------------------------

describe("POST /api/rooms/:id/snapshot", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("answers 401 when signed out", async () => {
    const app = await buildApp(null);
    apps.push(app);

    const response = await app.inject({ method: "POST", url: "/api/rooms/room-1/snapshot" });

    expect(response.statusCode).toBe(401);
  });

  it("answers 400 for an empty room id", async () => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({ method: "POST", url: "/api/rooms/%20/snapshot" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "invalid_params" } });
  });

  it("returns the snapshot and updated flag", async () => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({ method: "POST", url: "/api/rooms/room-1/snapshot" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ snapshot: snapshotDto, updated: true });
  });

  it("passes the signed-in user to the service", async () => {
    let receivedUser: UserAccount | undefined;
    const services = makeServices({
      update: (_id: string, user: UserAccount) => {
        receivedUser = user;
        return Promise.resolve({ snapshot: snapshotDto, updated: true });
      },
    });
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    await app.inject({ method: "POST", url: "/api/rooms/room-1/snapshot" });

    expect(receivedUser?.id).toBe(signedInUser.id);
  });

  it("maps SnapshotForbiddenError to 403", async () => {
    const services = makeServices({
      update: () => Promise.reject(new SnapshotForbiddenError("room-1")),
    });
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({ method: "POST", url: "/api/rooms/room-1/snapshot" });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "forbidden" } });
  });

  it("maps SnapshotRoomArchivedError to 409", async () => {
    const services = makeServices({
      update: () => Promise.reject(new SnapshotRoomArchivedError("room-1")),
    });
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({ method: "POST", url: "/api/rooms/room-1/snapshot" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "room_archived" } });
  });

  it("maps SnapshotRoomNotFoundError to 404", async () => {
    const services = makeServices({
      update: () => Promise.reject(new SnapshotRoomNotFoundError("missing")),
    });
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    const response = await app.inject({ method: "POST", url: "/api/rooms/missing/snapshot" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "room_not_found" } });
  });
});

// ---------------------------------------------------------------------------
// OpenAPI registration
// ---------------------------------------------------------------------------

describe("snapshot route OpenAPI registration", () => {
  it("registers the getRoomSnapshot operation", () => {
    const found = registeredRoutes.find(
      (r) => r.operation.operationId === getRoomSnapshotOpenApiMeta.operationId,
    );
    expect(found).toBeDefined();
    expect(found?.method).toBe("GET");
    expect(found?.openApiPath).toBe("/api/rooms/{id}/snapshot");
  });

  it("marks the getRoomSnapshot operation as session-protected", () => {
    const found = registeredRoutes.find(
      (r) => r.operation.operationId === getRoomSnapshotOpenApiMeta.operationId,
    );
    expect(found?.operation.security).toEqual([{ cookieAuth: [] }]);
    expect(found?.operation.responses?.["401"]).toBeDefined();
  });

  it("registers the updateRoomSnapshot operation", () => {
    const found = registeredRoutes.find(
      (r) => r.operation.operationId === updateRoomSnapshotOpenApiMeta.operationId,
    );
    expect(found).toBeDefined();
    expect(found?.method).toBe("POST");
    expect(found?.openApiPath).toBe("/api/rooms/{id}/snapshot");
  });

  it("marks the updateRoomSnapshot operation as session-protected", () => {
    const found = registeredRoutes.find(
      (r) => r.operation.operationId === updateRoomSnapshotOpenApiMeta.operationId,
    );
    expect(found?.operation.security).toEqual([{ cookieAuth: [] }]);
    expect(found?.operation.responses?.["401"]).toBeDefined();
  });
});
