import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { AppServices } from "../services.js";
import { openApiDocument, registerOpenApi } from "./openapi.js";
import { registerRoutes } from "./routes.js";

const expectedPaths = [
  "/api/health",
  "/api/application-settings",
  "/api/characters",
  "/api/characters/management",
  "/api/characters/export",
  "/api/characters/import",
  "/api/characters/{id}",
  "/api/characters/{id}/config",
  "/api/characters/{id}/restore",
  "/api/characters/bulk-create",
  "/api/character-bulk-jobs/{id}",
  "/api/characters/bulk-delete",
  "/api/model-profiles",
  "/api/user-profile",
  "/api/simulations",
  "/api/simulations/{id}",
  "/api/simulations/{id}/stop",
  "/api/simulations/{id}/resume",
  "/api/simulations/{id}/posts",
  "/api/posts/{id}",
  "/api/simulations/{id}/events",
];

describe("OpenAPI documentation", () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("documents every public API path with unique operation IDs", () => {
    expect(Object.keys(openApiDocument.paths).sort()).toEqual(expectedPaths.sort());

    const operationIds = Object.values(openApiDocument.paths).flatMap((path) =>
      [path?.get, path?.post, path?.put, path?.delete]
        .map((operation) => operation?.operationId)
        .filter((id): id is string => id !== undefined),
    );
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });

  it("stays in sync with the registered API routes", async () => {
    const app = Fastify();
    apps.push(app);
    const registeredOperations = new Set<string>();
    app.addHook("onRoute", (route) => {
      if (!route.url.startsWith("/api/")) return;
      const path = route.url.replace(/:([A-Za-z0-9_]+)/gu, "{$1}");
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) {
        if (method === "HEAD" || method === "OPTIONS") continue;
        registeredOperations.add(`${method.toLowerCase()} ${path}`);
      }
    });
    await registerRoutes(app, {} as AppServices);

    const documentedOperations = new Set<string>();
    for (const [path, item] of Object.entries(openApiDocument.paths)) {
      for (const method of ["get", "post", "put", "delete"] as const) {
        if (item?.[method]) documentedOperations.add(`${method} ${path}`);
      }
    }

    expect([...documentedOperations].sort()).toEqual([...registeredOperations].sort());
  });

  it("serves Swagger UI and the OpenAPI JSON document", async () => {
    const app = Fastify();
    apps.push(app);
    await registerOpenApi(app);
    await app.ready();

    const documentResponse = await app.inject({
      method: "GET",
      url: "/documentation/json",
    });
    expect(documentResponse.statusCode).toBe(200);
    expect(documentResponse.json()).toMatchObject({
      openapi: "3.0.3",
      info: { title: "Brickr API" },
      paths: { "/api/health": {} },
    });

    const uiResponse = await app.inject({
      method: "GET",
      url: "/documentation/",
    });
    expect(uiResponse.statusCode).toBe(200);
    expect(uiResponse.headers["content-type"]).toContain("text/html");
    expect(uiResponse.body).toContain("Brickr API Documentation");
  });
});
