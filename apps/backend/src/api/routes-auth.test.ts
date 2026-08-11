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

function makeServices(): AppServices {
  return {
    providerRegistry: { availableIds: () => ["mock"] },
    characters: {
      listDtos: () => Promise.resolve([]),
      listManagementDtos: () => Promise.resolve([]),
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
});
