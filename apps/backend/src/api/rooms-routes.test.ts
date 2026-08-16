/**
 * Tests for the `GET /api/rooms/:id` sample route (issue #150).
 *
 * Verifies the completion criteria:
 *   - auth: "required" → 401 when signed out
 *   - Zod validation → 400 for an invalid id
 *   - DomainError → mapped to its HTTP answer (404 for a missing room)
 *   - OpenAPI operation registered in registeredRoutes
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { UserAccount } from "../auth/user-account.js";
import { DomainError } from "../domain-error.js";
import { appErrorHandler } from "../app-error.js";
import type { AppServices } from "../services.js";
import { registeredRoutes } from "./define-route.js";
import { getRoomOpenApiMeta, registerRoomsRoutes } from "./rooms-routes.js";

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

class RoomNotFoundError extends DomainError {
  readonly httpStatus = 404;
  readonly errorCode = "not_found" as const;
}

const roomSummary = {
  id: "room-1",
  title: "テストルーム",
  status: "active" as const,
  createdAt: "2026-08-16T00:00:00.000Z",
  postCount: 5,
  lastActivityAt: "2026-08-16T00:00:00.000Z",
  creator: null,
  canManage: true,
};

function makeServices(overrides: Partial<AppServices["simulations"]> = {}): AppServices {
  return {
    simulations: {
      // services.simulations.get returns { simulation: SimulationSummaryDto }.
      get: () => Promise.resolve({ simulation: roomSummary }),
      ...overrides,
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

// ── Tests ─────────────────────────────────────────────────────────────────────

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
    // Fastify won't match an empty segment, so we test with a whitespace-only
    // id that passes the router but fails the Zod schema (trim → empty string).
    const app = await buildApp(signedInUser);
    apps.push(app);

    // A single space is URL-encoded as %20; after trim it becomes empty.
    const response = await app.inject({ method: "GET", url: "/api/rooms/%20" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "invalid_params" } });
  });

  it("returns the room summary when signed in", async () => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/rooms/room-1" });

    expect(response.statusCode).toBe(200);
    // The service returns { simulation: ... } and the handler passes it through.
    expect(response.json()).toEqual({ simulation: roomSummary });
  });

  it("maps a DomainError from the service to its HTTP answer", async () => {
    const services = makeServices({
      get: () => Promise.reject(new RoomNotFoundError("room not found")),
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
    const services = {
      simulations: {
        get: (_id: string, user: UserAccount) => {
          receivedUser = user;
          return Promise.resolve({ simulation: roomSummary });
        },
      },
    } as unknown as AppServices;
    const app = await buildApp(signedInUser, services);
    apps.push(app);

    await app.inject({ method: "GET", url: "/api/rooms/room-1" });

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

  it("marks the operation as session-protected", () => {
    const found = registeredRoutes.find(
      (r) => r.operation.operationId === getRoomOpenApiMeta.operationId,
    );
    expect(found?.operation.security).toEqual([{ cookieAuth: [] }]);
    expect(found?.operation.responses?.["401"]).toBeDefined();
  });

  it("includes the id path parameter", () => {
    const found = registeredRoutes.find(
      (r) => r.operation.operationId === getRoomOpenApiMeta.operationId,
    );
    const parameters = found?.operation.parameters as Array<{ name: string; in: string }> | undefined;
    expect(parameters).toContainEqual(
      expect.objectContaining({ name: "id", in: "path" }),
    );
  });
});
