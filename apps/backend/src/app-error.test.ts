import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "./app-error.js";

// ---------------------------------------------------------------------------
// Unit tests for AppError itself
// ---------------------------------------------------------------------------

describe("AppError", () => {
  it("is an instance of Error", () => {
    const error = new AppError("not_found", 404, "resource not found");
    expect(error).toBeInstanceOf(Error);
  });

  it("sets name to AppError", () => {
    const error = new AppError("not_found", 404, "resource not found");
    expect(error.name).toBe("AppError");
  });

  it("exposes code, status, and message", () => {
    const error = new AppError("forbidden", 403, "access denied");
    expect(error.code).toBe("forbidden");
    expect(error.status).toBe(403);
    expect(error.message).toBe("access denied");
  });

  it("exposes optional details when provided", () => {
    const details = { field: "email", reason: "already taken" };
    const error = new AppError("email_conflict", 409, "email taken", details);
    expect(error.details).toEqual(details);
  });

  it("details is undefined when not provided", () => {
    const error = new AppError("not_found", 404, "not found");
    expect(error.details).toBeUndefined();
  });

  describe("toResponse()", () => {
    it("returns the error envelope without details when details is absent", () => {
      const error = new AppError("not_found", 404, "resource not found");
      expect(error.toResponse()).toEqual({
        error: { code: "not_found", message: "resource not found" },
      });
    });

    it("includes details in the envelope when provided", () => {
      const details = { field: "handle" };
      const error = new AppError("handle_conflict", 409, "handle taken", details);
      expect(error.toResponse()).toEqual({
        error: { code: "handle_conflict", message: "handle taken", details: { field: "handle" } },
      });
    });

    it("does not include a details key when details is undefined", () => {
      const error = new AppError("internal_error", 500, "internal error");
      const response = error.toResponse();
      expect(Object.keys(response.error)).not.toContain("details");
    });
  });
});

// ---------------------------------------------------------------------------
// Integration tests: global error handler behaviour
// ---------------------------------------------------------------------------

/**
 * A minimal Fastify app that wires the same error handler logic as buildApp,
 * without importing app.ts (which transitively pulls in Prisma and requires a
 * generated client). This lets us verify the two completion criteria from
 * issue #149 in a pure unit-test environment:
 *   1. A known AppError → its defined status and code.
 *   2. An unknown exception → safe 500 internal_error envelope.
 */
function buildTestApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/throw-app-error", async () => {
    throw new AppError("forbidden", 403, "you shall not pass", { reason: "role" });
  });

  app.get("/throw-app-error-no-details", async () => {
    throw new AppError("not_found", 404, "thing not found");
  });

  app.get("/throw-unknown-error", async () => {
    throw new Error("something exploded internally");
  });

  // Mirror the error handler from app.ts so we test the real logic.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.status).send(error.toResponse());
    }
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    return reply.status(status).send({
      error: {
        code: "internal_error",
        message: status < 500 ? error.message : "internal error",
      },
    });
  });

  return app;
}

describe("global error handler", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it("returns the AppError status and code for a known AppError", async () => {
    app = buildTestApp();
    const response = await app.inject({ method: "GET", url: "/throw-app-error" });
    expect(response.statusCode).toBe(403);
    const body = response.json<{ error: { code: string; message: string; details?: unknown } }>();
    expect(body.error.code).toBe("forbidden");
    expect(body.error.message).toBe("you shall not pass");
    expect(body.error.details).toEqual({ reason: "role" });
  });

  it("returns the AppError status and code without details when absent", async () => {
    app = buildTestApp();
    const response = await app.inject({ method: "GET", url: "/throw-app-error-no-details" });
    expect(response.statusCode).toBe(404);
    const body = response.json<{ error: { code: string; message: string; details?: unknown } }>();
    expect(body.error.code).toBe("not_found");
    expect(body.error.message).toBe("thing not found");
    expect(Object.keys(body.error)).not.toContain("details");
  });

  it("returns a safe 500 internal_error envelope for an unknown exception", async () => {
    app = buildTestApp();
    const response = await app.inject({ method: "GET", url: "/throw-unknown-error" });
    expect(response.statusCode).toBe(500);
    const body = response.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe("internal_error");
    // The raw internal message must NOT be exposed to the client.
    expect(body.error.message).toBe("internal error");
    expect(body.error.message).not.toContain("exploded");
  });
});
