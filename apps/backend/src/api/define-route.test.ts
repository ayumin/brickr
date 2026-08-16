/**
 * Tests for the `defineRoute` infrastructure (issue #150).
 *
 * Covers:
 *   - auth: "required" → 401 when signed out
 *   - auth: "optional" → user is null when signed out, UserAccount when signed in
 *   - auth: "none"     → user is always null
 *   - params schema    → 400 for invalid path parameters
 *   - query schema     → 400 with details for invalid query parameters
 *   - body schema      → 400 with details for invalid request body
 *   - DomainError      → mapped to its HTTP answer
 *   - non-DomainError  → rethrown (→ 500 via Fastify's error handler)
 *   - OpenAPI          → operation derived from schemas and registered in registeredRoutes
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { UserAccount } from "../auth/user-account.js";
import { DomainError } from "../domain-error.js";
import { appErrorHandler } from "../app-error.js";
import { buildOpenApiOperation, defineRoute, registeredRoutes } from "./define-route.js";

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

class NotFoundError extends DomainError {
  readonly httpStatus = 404;
  readonly errorCode = "not_found" as const;
}

// ── Test helpers ──────────────────────────────────────────────────────────────

function buildApp(currentUser: UserAccount | null): FastifyInstance {
  const app = Fastify();
  app.decorateRequest("currentUser", null);
  app.addHook("onRequest", async (request) => {
    request.currentUser = currentUser;
  });
  app.setErrorHandler((error, request, reply) => {
    appErrorHandler(error, request, reply);
  });
  return app;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

describe("auth: required", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("answers 401 when signed out", async () => {
    const app = buildApp(null);
    apps.push(app);

    defineRoute({
      method: "GET",
      path: "/api/test/auth-required",
      auth: "required",
      response: z.object({ ok: z.boolean() }),
      handler: async () => ({ ok: true }),
    }).register(app);

    await app.ready();
    const response = await app.inject({ method: "GET", url: "/api/test/auth-required" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "unauthenticated" } });
  });

  it("passes the signed-in user to the handler", async () => {
    const app = buildApp(signedInUser);
    apps.push(app);

    let receivedUserId: string | undefined;

    defineRoute({
      method: "GET",
      path: "/api/test/auth-required-user",
      auth: "required",
      response: z.object({ userId: z.string() }),
      handler: async ({ user }) => {
        receivedUserId = user.id;
        return { userId: user.id };
      },
    }).register(app);

    await app.ready();
    const response = await app.inject({ method: "GET", url: "/api/test/auth-required-user" });

    expect(response.statusCode).toBe(200);
    expect(receivedUserId).toBe(signedInUser.id);
    expect(response.json()).toEqual({ userId: signedInUser.id });
  });
});

describe("auth: optional", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("passes null when signed out", async () => {
    const app = buildApp(null);
    apps.push(app);

    let receivedUser: UserAccount | null | undefined;

    defineRoute({
      method: "GET",
      path: "/api/test/auth-optional-anon",
      auth: "optional",
      response: z.object({ signedIn: z.boolean() }),
      handler: async ({ user }) => {
        receivedUser = user;
        return { signedIn: user !== null };
      },
    }).register(app);

    await app.ready();
    const response = await app.inject({ method: "GET", url: "/api/test/auth-optional-anon" });

    expect(response.statusCode).toBe(200);
    expect(receivedUser).toBeNull();
    expect(response.json()).toEqual({ signedIn: false });
  });

  it("passes the user when signed in", async () => {
    const app = buildApp(signedInUser);
    apps.push(app);

    defineRoute({
      method: "GET",
      path: "/api/test/auth-optional-user",
      auth: "optional",
      response: z.object({ signedIn: z.boolean() }),
      handler: async ({ user }) => ({ signedIn: user !== null }),
    }).register(app);

    await app.ready();
    const response = await app.inject({ method: "GET", url: "/api/test/auth-optional-user" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ signedIn: true });
  });
});

describe("auth: none", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("always passes null as user, even when signed in", async () => {
    const app = buildApp(signedInUser);
    apps.push(app);

    let receivedUser: null | undefined;

    defineRoute({
      method: "GET",
      path: "/api/test/auth-none",
      auth: "none",
      response: z.object({ user: z.null() }),
      handler: async ({ user }) => {
        receivedUser = user;
        return { user };
      },
    }).register(app);

    await app.ready();
    const response = await app.inject({ method: "GET", url: "/api/test/auth-none" });

    expect(response.statusCode).toBe(200);
    expect(receivedUser).toBeNull();
  });
});

// ── Params validation ─────────────────────────────────────────────────────────

describe("params validation", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("answers 400 for invalid path parameters", async () => {
    const app = buildApp(signedInUser);
    apps.push(app);

    defineRoute({
      method: "GET",
      path: "/api/test/params/:id",
      auth: "required",
      params: z.object({ id: z.string().min(5) }),
      response: z.object({ id: z.string() }),
      handler: async ({ params }) => ({ id: params.id }),
    }).register(app);

    await app.ready();
    // "ab" is shorter than the minimum of 5
    const response = await app.inject({ method: "GET", url: "/api/test/params/ab" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "invalid_params" } });
  });

  it("passes parsed params to the handler", async () => {
    const app = buildApp(signedInUser);
    apps.push(app);

    defineRoute({
      method: "GET",
      path: "/api/test/params-ok/:id",
      auth: "required",
      params: z.object({ id: z.string().min(1) }),
      response: z.object({ id: z.string() }),
      handler: async ({ params }) => ({ id: params.id }),
    }).register(app);

    await app.ready();
    const response = await app.inject({ method: "GET", url: "/api/test/params-ok/hello" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: "hello" });
  });
});

// ── Query validation ──────────────────────────────────────────────────────────

describe("query validation", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("answers 400 with details for invalid query parameters", async () => {
    const app = buildApp(signedInUser);
    apps.push(app);

    defineRoute({
      method: "GET",
      path: "/api/test/query",
      auth: "required",
      query: z.object({ page: z.coerce.number().int().min(1) }),
      response: z.object({ page: z.number() }),
      handler: async ({ query }) => ({ page: query.page }),
    }).register(app);

    await app.ready();
    const response = await app.inject({ method: "GET", url: "/api/test/query?page=0" });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toMatchObject({ error: { code: "invalid_query" } });
    expect(body.error.details).toBeDefined();
  });

  it("passes parsed query to the handler", async () => {
    const app = buildApp(signedInUser);
    apps.push(app);

    defineRoute({
      method: "GET",
      path: "/api/test/query-ok",
      auth: "required",
      query: z.object({ page: z.coerce.number().int().min(1) }),
      response: z.object({ page: z.number() }),
      handler: async ({ query }) => ({ page: query.page }),
    }).register(app);

    await app.ready();
    const response = await app.inject({ method: "GET", url: "/api/test/query-ok?page=3" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ page: 3 });
  });
});

// ── Body validation ───────────────────────────────────────────────────────────

describe("body validation", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("answers 400 with details for an invalid request body", async () => {
    const app = buildApp(signedInUser);
    apps.push(app);

    defineRoute({
      method: "POST",
      path: "/api/test/body",
      auth: "required",
      body: z.object({ name: z.string().min(1) }),
      response: z.object({ name: z.string() }),
      handler: async ({ body }) => ({ name: body.name }),
    }).register(app);

    await app.ready();
    const response = await app.inject({
      method: "POST",
      url: "/api/test/body",
      payload: { name: "" },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toMatchObject({ error: { code: "invalid_body" } });
    expect(body.error.details).toBeDefined();
  });

  it("passes parsed body to the handler", async () => {
    const app = buildApp(signedInUser);
    apps.push(app);

    defineRoute({
      method: "POST",
      path: "/api/test/body-ok",
      auth: "required",
      body: z.object({ name: z.string().min(1) }),
      response: z.object({ name: z.string() }),
      handler: async ({ body }) => ({ name: body.name }),
    }).register(app);

    await app.ready();
    const response = await app.inject({
      method: "POST",
      url: "/api/test/body-ok",
      payload: { name: "花子" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ name: "花子" });
  });
});

// ── DomainError mapping ───────────────────────────────────────────────────────

describe("DomainError mapping", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("maps a DomainError to its HTTP answer", async () => {
    const app = buildApp(signedInUser);
    apps.push(app);

    defineRoute({
      method: "GET",
      path: "/api/test/domain-error",
      auth: "required",
      response: z.object({ ok: z.boolean() }),
      handler: async () => {
        throw new NotFoundError("thing not found");
      },
    }).register(app);

    await app.ready();
    const response = await app.inject({ method: "GET", url: "/api/test/domain-error" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: "not_found", message: "thing not found" },
    });
  });

  it("rethrows a non-DomainError so Fastify's error handler answers 500", async () => {
    const app = buildApp(signedInUser);
    apps.push(app);

    defineRoute({
      method: "GET",
      path: "/api/test/unexpected-error",
      auth: "required",
      response: z.object({ ok: z.boolean() }),
      handler: async () => {
        throw new Error("unexpected boom");
      },
    }).register(app);

    await app.ready();
    const response = await app.inject({ method: "GET", url: "/api/test/unexpected-error" });

    expect(response.statusCode).toBe(500);
  });
});

// ── OpenAPI registration ──────────────────────────────────────────────────────

describe("buildOpenApiOperation", () => {
  it("registers an operation in registeredRoutes", () => {
    const before = registeredRoutes.length;

    buildOpenApiOperation(
      {
        method: "GET",
        path: "/api/test/openapi-sample",
        auth: "required",
        params: z.object({ id: z.string().min(1) }),
        response: z.object({ id: z.string() }),
      },
      {
        operationId: "testOpenApiSample",
        tags: ["System"],
        summary: "Test operation",
      },
    );

    expect(registeredRoutes.length).toBe(before + 1);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const registered = registeredRoutes[registeredRoutes.length - 1]!;
    expect(registered.method).toBe("GET");
    expect(registered.openApiPath).toBe("/api/test/openapi-sample");
    expect(registered.operation.operationId).toBe("testOpenApiSample");
  });

  it("derives path parameters from the params schema", () => {
    buildOpenApiOperation(
      {
        method: "GET",
        path: "/api/test/openapi-params/:id",
        auth: "required",
        params: z.object({ id: z.string().min(1).max(64) }),
        response: z.object({ id: z.string() }),
      },
      { operationId: "testOpenApiParams" },
    );

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const registered = registeredRoutes[registeredRoutes.length - 1]!;
    const parameters = registered.operation.parameters as Array<{ name: string; in: string; required: boolean }>;
    expect(parameters).toContainEqual(
      expect.objectContaining({ name: "id", in: "path", required: true }),
    );
  });

  it("derives query parameters from the query schema", () => {
    buildOpenApiOperation(
      {
        method: "GET",
        path: "/api/test/openapi-query",
        auth: "required",
        query: z.object({ page: z.coerce.number().int().min(1).optional() }),
        response: z.object({ page: z.number() }),
      },
      { operationId: "testOpenApiQuery" },
    );

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const registered = registeredRoutes[registeredRoutes.length - 1]!;
    const parameters = registered.operation.parameters as Array<{ name: string; in: string }>;
    expect(parameters).toContainEqual(
      expect.objectContaining({ name: "page", in: "query" }),
    );
  });

  it("includes a 401 response for auth: required", () => {
    buildOpenApiOperation(
      {
        method: "GET",
        path: "/api/test/openapi-auth",
        auth: "required",
        response: z.object({ ok: z.boolean() }),
      },
      { operationId: "testOpenApiAuth" },
    );

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const registered = registeredRoutes[registeredRoutes.length - 1]!;
    expect(registered.operation.responses?.["401"]).toBeDefined();
    expect(registered.operation.security).toEqual([{ cookieAuth: [] }]);
  });

  it("omits 401 and security for auth: none", () => {
    buildOpenApiOperation(
      {
        method: "GET",
        path: "/api/test/openapi-no-auth",
        auth: "none",
        response: z.object({ ok: z.boolean() }),
      },
      { operationId: "testOpenApiNoAuth" },
    );

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const registered = registeredRoutes[registeredRoutes.length - 1]!;
    expect(registered.operation.responses?.["401"]).toBeUndefined();
    expect(registered.operation.security).toBeUndefined();
  });

  it("derives a request body schema from the body schema", () => {
    buildOpenApiOperation(
      {
        method: "POST",
        path: "/api/test/openapi-body",
        auth: "required",
        body: z.object({ name: z.string().min(1) }),
        response: z.object({ name: z.string() }),
      },
      { operationId: "testOpenApiBody" },
    );

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const registered = registeredRoutes[registeredRoutes.length - 1]!;
    expect(registered.operation.requestBody).toBeDefined();
  });

  it("converts Fastify-style path params to OpenAPI-style", () => {
    buildOpenApiOperation(
      {
        method: "GET",
        path: "/api/test/:userId/items/:itemId",
        auth: "none",
        response: z.object({ ok: z.boolean() }),
      },
      { operationId: "testOpenApiPathConversion" },
    );

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const registered = registeredRoutes[registeredRoutes.length - 1]!;
    expect(registered.openApiPath).toBe("/api/test/{userId}/items/{itemId}");
  });
});

// ── withOpenApi on defineRoute ────────────────────────────────────────────────

describe("defineRoute.withOpenApi", () => {
  it("registers the operation in registeredRoutes", () => {
    const before = registeredRoutes.length;

    defineRoute({
      method: "GET",
      path: "/api/test/define-route-openapi",
      auth: "required",
      response: z.object({ ok: z.boolean() }),
      handler: async () => ({ ok: true }),
    }).withOpenApi({
      operationId: "testDefineRouteOpenApi",
      summary: "Test",
    });

    expect(registeredRoutes.length).toBe(before + 1);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const registered = registeredRoutes[registeredRoutes.length - 1]!;
    expect(registered.operation.operationId).toBe("testDefineRouteOpenApi");
  });
});

// ── HTTP methods ──────────────────────────────────────────────────────────────

describe("HTTP methods", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it.each(["GET", "POST", "PUT", "DELETE"] as const)(
    "registers a %s route",
    async (method) => {
      const app = buildApp(signedInUser);
      apps.push(app);

      defineRoute({
        method,
        path: `/api/test/method-${method.toLowerCase()}`,
        auth: "required",
        response: z.object({ method: z.string() }),
        handler: async () => ({ method }),
      }).register(app);

      await app.ready();
      const response = await app.inject({
        method,
        url: `/api/test/method-${method.toLowerCase()}`,
        ...(method !== "GET" && method !== "DELETE" ? { payload: {} } : {}),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ method });
    },
  );
});
