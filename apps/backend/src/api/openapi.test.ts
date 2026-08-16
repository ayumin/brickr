import { MAX_PASSWORD_LENGTH, MAX_POST_LENGTH, MIN_PASSWORD_LENGTH } from "@brickr/shared";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { AppServices } from "../services.js";
import { registeredRoutes } from "./define-route.js";
import { openApiDocument, registerOpenApi } from "./openapi.js";
import { registerRoutes } from "./routes.js";

type SchemaObjectWithProperties = {
  properties?: Record<string, { minLength?: number; maxLength?: number; pattern?: string }>;
  minProperties?: number;
};

function schema(name: string): SchemaObjectWithProperties {
  const found = openApiDocument.components?.schemas?.[name];
  if (!found || "$ref" in found) throw new Error(`no inline schema named "${name}"`);
  return found as SchemaObjectWithProperties;
}

const expectedPaths = [
  "/api/health",
  "/api/auth/session",
  "/api/auth/signup",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/users/management",
  "/api/users/{id}",
  "/api/users/{id}/suspend",
  "/api/users/{id}/reactivate",
  "/api/users/{id}/reset-password",
  "/api/users/{id}/characters",
  "/api/users/{id}/token-usage",
  "/api/invite-codes",
  "/api/profiles/{handle}",
  "/api/profiles/{handle}/posts",
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
  "/api/user-profile/token-usage",
  "/api/feed",
  "/api/simulations",
  "/api/simulations/{id}",
  "/api/simulations/{id}/analysis",
  "/api/simulations/{id}/feed",
  "/api/simulations/{id}/stop",
  "/api/simulations/{id}/resume",
  "/api/simulations/{id}/posts",
  "/api/posts/{id}",
  "/api/posts/{threadRootId}/replies",
  "/api/feed/events",
  "/api/simulations/{id}/events",
  "/api/rooms/{id}",
];

const sessionProtectedOperationIds = [
  // Reads that used to be public. Step 3 closed them: every public endpoint is
  // another way to learn whether a handle is a person or an AI (§25), so only the
  // unified feed and its stream stay open (§5.1, §10.8).
  "getPublicProfile",
  "listPublicProfilePosts",
  "listCharacters",
  "listCharactersForManagement",
  "exportCharactersCsv",
  "getCharacter",
  "getCharacterConfig",
  "getCharacterBulkCreationJob",
  "listModelProfiles",
  "listSimulations",
  "getSimulation",
  "listSimulationPosts",
  "getPostThread",
  "listUserManagement",
  "getUser",
  "suspendUser",
  "reactivateUser",
  "resetUserPassword",
  "listUserCharacters",
  "getUserTokenUsage",
  "createInviteCode",
  "listInviteCodes",
  "getApplicationSettings",
  "updateApplicationSettings",
  "createCharacter",
  "importCharactersCsv",
  "updateCharacter",
  "deleteCharacter",
  "restoreCharacter",
  "bulkCreateCharacters",
  "bulkDeleteCharacters",
  "getUserProfile",
  "updateUserProfile",
  "getOwnTokenUsage",
  "createSimulation",
  "updateSimulation",
  "analyzeSimulation",
  "stopSimulation",
  "resumeSimulation",
  "getSimulationFeed",
  "createPost",
  "listThreadReplies",
  "streamSimulationEvents",
  "getRoomSummary",
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

  it("serves defineRoute operations from the registered source of truth", () => {
    const registered = registeredRoutes.find(
      (route) => route.operation.operationId === "getRoomSummary",
    );
    expect(registered).toBeDefined();
    expect(openApiDocument.paths["/api/rooms/{id}"]?.get).toBe(registered?.operation);

    const parameters = registered?.operation.parameters as
      | Array<{ name: string; in: string }>
      | undefined;
    expect(
      parameters?.filter((parameter) => parameter.name === "id" && parameter.in === "path"),
    ).toHaveLength(1);
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

  it("marks every protected operation with cookie auth and a 401 response", () => {
    expect(openApiDocument.components?.securitySchemes).toMatchObject({
      cookieAuth: { type: "apiKey", in: "cookie", name: "brickr_session" },
    });

    const operations = Object.values(openApiDocument.paths).flatMap((path) =>
      [path?.get, path?.post, path?.put, path?.delete].filter(
        (operation): operation is NonNullable<typeof operation> => operation !== undefined,
      ),
    );
    const protectedOperations = operations.filter((operation) =>
      sessionProtectedOperationIds.includes(operation.operationId ?? ""),
    );

    expect(protectedOperations).toHaveLength(sessionProtectedOperationIds.length);
    for (const operation of protectedOperations) {
      expect(operation.security, operation.operationId).toEqual([{ cookieAuth: [] }]);
      expect(operation.responses?.["401"], operation.operationId).toBeDefined();
    }
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

/**
 * Request schemas are derived from schemas.ts (api/openapi-schemas.ts), so
 * `components.schemas.X === requestSchema(xSchema)` by construction — that
 * equality is not worth asserting. What is worth asserting is the actual
 * constraint values the document ends up serving, cross-checked against the
 * shared constants the validator itself uses: this is what would catch
 * either side changing a bound without the other moving too.
 */
describe("openapi request schema field constraints", () => {
  it("LoginRequest.password matches the shared password length bounds", () => {
    expect(schema("LoginRequest").properties?.password).toMatchObject({
      minLength: 1,
      maxLength: MAX_PASSWORD_LENGTH,
    });
  });

  it("SignupRequest.password matches the shared password length bounds", () => {
    expect(schema("SignupRequest").properties?.password).toMatchObject({
      minLength: MIN_PASSWORD_LENGTH,
      maxLength: MAX_PASSWORD_LENGTH,
    });
  });

  it("CreatePost.content matches the shared post length bound", () => {
    expect(schema("CreatePost").properties?.content).toMatchObject({
      maxLength: MAX_POST_LENGTH,
    });
  });

  it("SaveCharacter.handle keeps the shared handle pattern", () => {
    expect(schema("SaveCharacter").properties?.handle).toMatchObject({
      pattern: "^[a-z0-9_]{3,32}$",
    });
  });

  it("SaveCharacter.rolePrompt/tonePrompt keep their length bounds", () => {
    const properties = schema("SaveCharacter").properties;
    expect(properties?.rolePrompt).toMatchObject({ minLength: 1, maxLength: 4000 });
    expect(properties?.tonePrompt).toMatchObject({ minLength: 1, maxLength: 4000 });
  });

  it("UpdateApplicationSettingsRequest.overrides requires at least one entry", () => {
    expect(schema("UpdateApplicationSettingsRequest").properties?.overrides).toMatchObject({
      minProperties: 1,
    });
  });
});
