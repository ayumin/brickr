import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthService } from "./auth-service.js";
import { registerAuthContext, requireAdmin, requireUser } from "./auth-context.js";
import type { UserAccount } from "./user-account.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const activeUser: UserAccount = {
  id: "user-1",
  handle: "hanako",
  displayName: "花子",
  description: "",
  email: "hanako@example.com",
  isAdmin: false,
  status: "active",
  interests: [],
};

const adminUser: UserAccount = { ...activeUser, id: "admin-1", isAdmin: true };

// ---------------------------------------------------------------------------
// requireUser
// ---------------------------------------------------------------------------

/**
 * Build a minimal FastifyRequest / FastifyReply pair for testing the guards
 * without spinning up a full HTTP server.
 */
function makeRequestReply(currentUser: UserAccount | null): {
  request: FastifyRequest;
  reply: FastifyReply;
  statusCode: () => number | undefined;
  sentBody: () => unknown;
} {
  let _statusCode: number | undefined;
  let _sentBody: unknown;

  const reply = {
    status(code: number) {
      _statusCode = code;
      return reply;
    },
    send(body: unknown) {
      _sentBody = body;
      return reply;
    },
  } as unknown as FastifyReply;

  const request = { currentUser } as unknown as FastifyRequest;

  return {
    request,
    reply,
    statusCode: () => _statusCode,
    sentBody: () => _sentBody,
  };
}

describe("requireUser", () => {
  it("returns the user when a session is present", () => {
    const { request, reply } = makeRequestReply(activeUser);
    const result = requireUser(request, reply);
    expect(result).toBe(activeUser);
  });

  it("returns null and sends 401 when there is no session", () => {
    const { request, reply, statusCode, sentBody } = makeRequestReply(null);
    const result = requireUser(request, reply);

    expect(result).toBeNull();
    expect(statusCode()).toBe(401);
    expect(sentBody()).toMatchObject({ error: { code: "unauthenticated" } });
  });
});

// ---------------------------------------------------------------------------
// requireAdmin
// ---------------------------------------------------------------------------

describe("requireAdmin", () => {
  it("returns the user when the session belongs to an admin", () => {
    const { request, reply } = makeRequestReply(adminUser);
    const result = requireAdmin(request, reply);
    expect(result).toBe(adminUser);
  });

  it("returns null and sends 401 when there is no session", () => {
    const { request, reply, statusCode, sentBody } = makeRequestReply(null);
    const result = requireAdmin(request, reply);

    expect(result).toBeNull();
    expect(statusCode()).toBe(401);
    expect(sentBody()).toMatchObject({ error: { code: "unauthenticated" } });
  });

  it("returns null and sends 403 when the signed-in user is not an admin", () => {
    const { request, reply, statusCode, sentBody } = makeRequestReply(activeUser);
    const result = requireAdmin(request, reply);

    expect(result).toBeNull();
    expect(statusCode()).toBe(403);
    expect(sentBody()).toMatchObject({ error: { code: "forbidden" } });
  });
});

// ---------------------------------------------------------------------------
// registerAuthContext
// ---------------------------------------------------------------------------

describe("registerAuthContext", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  function makeAuthMock(resolvedUser: UserAccount | null): AuthService {
    return {
      resolveSession: vi.fn().mockResolvedValue(resolvedUser),
    } as unknown as AuthService;
  }

  async function buildApp(auth: AuthService): Promise<FastifyInstance> {
    const app = Fastify();
    registerAuthContext(app, auth);
    // A minimal route that echoes back whatever currentUser was set to.
    app.get("/probe", async (request) => ({
      user: request.currentUser,
    }));
    await app.ready();
    apps.push(app);
    return app;
  }

  it("sets currentUser to the resolved account when the cookie carries a valid token", async () => {
    const auth = makeAuthMock(activeUser);
    const app = await buildApp(auth);

    const response = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { cookie: "brickr_session=valid-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ user: { id: activeUser.id } });
    expect(auth.resolveSession).toHaveBeenCalledWith("valid-token");
  });

  it("sets currentUser to null when there is no session cookie", async () => {
    const auth = makeAuthMock(null);
    const app = await buildApp(auth);

    const response = await app.inject({ method: "GET", url: "/probe" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ user: null });
    expect(auth.resolveSession).toHaveBeenCalledWith(null);
  });

  it("passes the raw token from the cookie to resolveSession", async () => {
    const auth = makeAuthMock(null);
    const app = await buildApp(auth);

    await app.inject({
      method: "GET",
      url: "/probe",
      headers: { cookie: "brickr_session=my-secret-token; Path=/" },
    });

    expect(auth.resolveSession).toHaveBeenCalledWith("my-secret-token");
  });
});
