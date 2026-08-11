import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { UserAccount } from "../auth/user-account.js";
import type { AppServices } from "../services.js";
import { registerRoutes } from "./routes.js";

/**
 * The authentication boundary of the HTTP surface (CLAUDE.md §66.12, #34).
 *
 * Services are stubbed to succeed, so a non-401 status is enough to show the
 * guard let the request through. What is being tested is who may call what, not
 * what the handlers do with it.
 */

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

const adminUser: UserAccount = { ...signedInUser, id: "admin-1", handle: "admin", isAdmin: true };

const characterBody = {
  handle: "architect",
  displayName: "アーキテクト",
  description: "設計の話をする",
  rolePrompt: "role",
  tonePrompt: "tone",
  interests: ["建築"],
  activityLevel: 0.5,
  responseProbability: 0.5,
  replyProbability: 0.6,
  quoteProbability: 0.2,
  influence: 0.5,
  modelProfileId: "model-1",
};

/** Every route that must refuse a signed-out caller. */
const writeRoutes = [
  { method: "POST" as const, url: "/api/simulations", payload: {} },
  { method: "PUT" as const, url: "/api/simulations/s1", payload: { title: "t" } },
  { method: "POST" as const, url: "/api/simulations/s1/stop", payload: undefined },
  { method: "POST" as const, url: "/api/simulations/s1/resume", payload: undefined },
  { method: "POST" as const, url: "/api/simulations/s1/posts", payload: { content: "hi" } },
  { method: "POST" as const, url: "/api/characters", payload: characterBody },
  { method: "PUT" as const, url: "/api/characters/c1", payload: characterBody },
  { method: "DELETE" as const, url: "/api/characters/c1", payload: undefined },
  { method: "POST" as const, url: "/api/characters/bulk-create", payload: { count: 1 } },
  { method: "POST" as const, url: "/api/characters/bulk-delete", payload: { ids: ["c1"] } },
  { method: "POST" as const, url: "/api/characters/import", payload: { csv: "handle\n" } },
  { method: "POST" as const, url: "/api/characters/c1/restore", payload: undefined },
  {
    method: "PUT" as const,
    url: "/api/user-profile",
    payload: { displayName: "花子", description: "" },
  },
];

/** Reads stay open: browsing needs no invite, and `/handle` must render (§66.2). */
const publicRoutes = [
  "/api/health",
  "/api/characters",
  "/api/characters/management",
  "/api/model-profiles",
  "/api/simulations",
  "/api/auth/session",
];

/** Every route that requires admin access (§66.7, §66.9, §66.15, §66.16). */
const adminRoutes = [
  // User-management routes (§66.7, §66.15)
  { method: "GET" as const, url: "/api/users/management", payload: undefined },
  { method: "GET" as const, url: "/api/users/user-1", payload: undefined },
  { method: "POST" as const, url: "/api/users/user-1/suspend", payload: undefined },
  { method: "POST" as const, url: "/api/users/user-1/reactivate", payload: undefined },
  { method: "POST" as const, url: "/api/users/user-1/reset-password", payload: undefined },
  { method: "GET" as const, url: "/api/users/user-1/characters", payload: undefined },
  { method: "GET" as const, url: "/api/users/user-1/token-usage", payload: undefined },
  // Application-settings routes (§66.16)
  { method: "GET" as const, url: "/api/application-settings", payload: undefined },
  {
    method: "PUT" as const,
    url: "/api/application-settings",
    payload: { overrides: { LLM_TIMEOUT_MS: "5000" } },
  },
  // Invite-code routes (§66.9, §66.15)
  { method: "POST" as const, url: "/api/invite-codes", payload: {}, expectedStatus: 201 },
  { method: "GET" as const, url: "/api/invite-codes", payload: undefined },
];

function makeServices(): AppServices {
  return {
    providerRegistry: { availableIds: () => ["mock"] },
    userAdmin: {
      listManagement: (query: { page: number; search?: string }) =>
        Promise.resolve({ accounts: [], page: query.page, pageSize: 100, totalCount: 0 }),
      findById: (id: string) => Promise.resolve(id === "user-1" ? signedInUser : null),
      suspend: () => Promise.resolve(signedInUser),
      reactivate: () => Promise.resolve(signedInUser),
      resetPassword: () =>
        Promise.resolve({ user: signedInUser, temporaryPassword: "a-temp-password" }),
    },
    characters: {
      listDtos: () => Promise.resolve([]),
      listManagementDtos: () => Promise.resolve([]),
      listManagementDtosByCreator: () => Promise.resolve([]),
      create: () => Promise.resolve({ id: "c1" }),
      update: () => Promise.resolve({ id: "c1" }),
      delete: () => Promise.resolve("c1"),
      deleteMany: () => Promise.resolve(["c1"]),
      restore: () => Promise.resolve("c1"),
      importCsv: () => Promise.resolve({ created: 0, updated: 0, skipped: 0 }),
      startCreateMany: () => ({ id: "job-1" }),
    },
    modelProfiles: { listDtos: () => Promise.resolve([]) },
    userProfile: {
      get: () => Promise.resolve({ id: "user-1" }),
      update: () => Promise.resolve({ id: "user-1" }),
    },
    simulations: {
      list: () => Promise.resolve([]),
      create: () => Promise.resolve({ id: "s1" }),
      rename: () => Promise.resolve({ id: "s1" }),
      stop: () => Promise.resolve({ id: "s1" }),
      resume: () => Promise.resolve({ id: "s1" }),
      submitUserPost: () => Promise.resolve({ id: "p1" }),
    },
    posts: { toDto: () => Promise.resolve({ id: "p1" }) },
    simulationAnalysis: { analyze: () => Promise.resolve({ postCount: 0 }) },
    applicationSettings: {
      get: () => Promise.resolve({ environment: [], llm: {} }),
      update: () => Promise.resolve({ environment: [], llm: {} }),
    },
    inviteCodes: {
      issue: () =>
        Promise.resolve({ code: "abc123", issuedById: "admin-1", createdAt: new Date() }),
      list: () => Promise.resolve([]),
    },
    tokenUsage: {
      getDto: () =>
        Promise.resolve({ totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0 }),
    },
  } as unknown as AppServices;
}

async function buildApp(currentUser: UserAccount | null): Promise<FastifyInstance> {
  const app = Fastify();
  // Stands in for registerAuthContext, which resolves the session cookie.
  app.decorateRequest("currentUser", null);
  app.addHook("onRequest", async (request) => {
    request.currentUser = currentUser;
  });
  await registerRoutes(app, makeServices());
  await app.ready();
  return app;
}

describe("write endpoints while signed out", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it.each(writeRoutes)("refuses $method $url with 401", async ({ method, url, payload }) => {
    const app = await buildApp(null);
    apps.push(app);

    const response = await app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload }),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "unauthenticated" } });
  });

  it("answers 401 before validating the body, so it reveals nothing about the payload", async () => {
    const app = await buildApp(null);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/characters",
      payload: { handle: "NOT A HANDLE" },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("write endpoints while signed in", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it.each(writeRoutes)("allows $method $url", async ({ method, url, payload }) => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload }),
    });

    expect(response.statusCode).not.toBe(401);
  });
});

describe("read endpoints", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it.each(publicRoutes)("keeps GET %s open to a signed-out caller", async (url) => {
    const app = await buildApp(null);
    apps.push(app);

    const response = await app.inject({ method: "GET", url });

    expect(response.statusCode).not.toBe(401);
  });

  // The exception among reads: "my profile" has no meaning without a session.
  it("refuses GET /api/user-profile while signed out", async () => {
    const app = await buildApp(null);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/user-profile" });

    expect(response.statusCode).toBe(401);
  });

  it("returns the signed-in user's own profile", async () => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/user-profile" });

    expect(response.statusCode).toBe(200);
  });

  // Also an exception: unlike the simulation itself, its analysis is not public (§66.6).
  it("refuses GET /api/simulations/:id/analysis while signed out", async () => {
    const app = await buildApp(null);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/simulations/s1/analysis" });

    expect(response.statusCode).toBe(401);
  });

  it("lets a signed-in caller request the analysis (ownership is checked in the service)", async () => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/simulations/s1/analysis" });

    expect(response.statusCode).toBe(200);
  });

  // Also an exception: "my token usage" has no meaning without a session (§66.4).
  it("refuses GET /api/user-profile/token-usage while signed out", async () => {
    const app = await buildApp(null);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/user-profile/token-usage" });

    expect(response.statusCode).toBe(401);
  });

  it("returns the signed-in user's own token usage", async () => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/user-profile/token-usage" });

    expect(response.statusCode).toBe(200);
  });
});

describe("admin-only endpoints while signed out", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it.each(adminRoutes)("refuses $method $url with 401", async ({ method, url, payload }) => {
    const app = await buildApp(null);
    apps.push(app);

    const response = await app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload }),
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("admin-only endpoints while signed in as a non-admin", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it.each(adminRoutes)("refuses $method $url with 403", async ({ method, url, payload }) => {
    const app = await buildApp(signedInUser);
    apps.push(app);

    const response = await app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload }),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "forbidden" } });
  });
});

describe("admin-only endpoints while signed in as an admin", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it.each(adminRoutes)("allows $method $url", async ({ method, url, payload, expectedStatus }) => {
    const app = await buildApp(adminUser);
    apps.push(app);

    const response = await app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload }),
    });

    expect(response.statusCode).toBe(expectedStatus ?? 200);
  });

  it("passes page and search through to the service", async () => {
    const app = Fastify();
    apps.push(app);
    app.decorateRequest("currentUser", null);
    app.addHook("onRequest", async (request) => {
      request.currentUser = adminUser;
    });
    let received: { page: number; search?: string } | undefined;
    const services = {
      ...makeServices(),
      userAdmin: {
        ...makeServices().userAdmin,
        listManagement: (query: { page: number; search?: string }) => {
          received = query;
          return Promise.resolve({ accounts: [], page: query.page, pageSize: 100, totalCount: 0 });
        },
      },
    } as unknown as AppServices;
    await registerRoutes(app, services);
    await app.ready();

    await app.inject({ method: "GET", url: "/api/users/management?page=2&search=hanako" });

    expect(received).toEqual({ page: 2, search: "hanako" });
  });

  it("returns the temporary password once from reset-password", async () => {
    const app = await buildApp(adminUser);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/users/user-1/reset-password",
    });

    expect(response.json()).toEqual({ temporaryPassword: "a-temp-password" });
  });

  it("404s for an unknown user id", async () => {
    const app = await buildApp(adminUser);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/users/nobody" });

    expect(response.statusCode).toBe(404);
  });

  it("issues the code as the signed-in admin", async () => {
    const app = Fastify();
    apps.push(app);
    app.decorateRequest("currentUser", null);
    app.addHook("onRequest", async (request) => {
      request.currentUser = adminUser;
    });
    let issuedBy: string | undefined;
    const services = {
      ...makeServices(),
      inviteCodes: {
        issue: (issuedById: string) => {
          issuedBy = issuedById;
          return Promise.resolve({ code: "abc123", issuedById, createdAt: new Date() });
        },
        list: () => Promise.resolve([]),
      },
    } as unknown as AppServices;
    await registerRoutes(app, services);
    await app.ready();

    const response = await app.inject({ method: "POST", url: "/api/invite-codes", payload: {} });

    expect(response.statusCode).toBe(201);
    expect(issuedBy).toBe(adminUser.id);
  });

  // OpenAPI marks the whole body optional, so omitting it entirely (not just
  // sending `{}`) must succeed too — regression coverage for #24 review (!13).
  it("issues a non-expiring code when the request has no body at all", async () => {
    const app = await buildApp(adminUser);
    apps.push(app);

    const response = await app.inject({ method: "POST", url: "/api/invite-codes" });

    expect(response.statusCode).toBe(201);
  });
});
