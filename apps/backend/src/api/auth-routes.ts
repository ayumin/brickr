import type { FastifyInstance, FastifyReply } from "fastify";
import type { IssuedSession } from "../auth/auth-service.js";
import {
  readSessionCookie,
  serializeClearedSessionCookie,
  serializeSessionCookie,
  type SessionCookieOptions,
} from "../auth/session-cookie.js";
import { toAuthUserDto } from "../auth/user-account.js";
import { env } from "../config/env.js";
import type { AppServices } from "../services.js";
import { sendError } from "./errors.js";
import { parseOr400, withDomainErrors } from "./route-helpers.js";
import { loginSchema, signupSchema } from "./schemas.js";

export function registerAuthRoutes(app: FastifyInstance, services: AppServices): void {
  const cookieOptions: SessionCookieOptions = {
    secure: env.auth.cookieSecure,
    maxAgeSeconds: Math.floor(env.auth.sessionTtlMs / 1000),
  };

  /** Lets the frontend boot without guessing: `null` simply means signed out. */
  app.get("/api/auth/session", async (request) => ({
    user: request.currentUser ? toAuthUserDto(request.currentUser) : null,
  }));

  app.post("/api/auth/signup", async (request, reply) => {
    const body = parseOr400(signupSchema, request.body, reply, "invalid_body", "signup body is invalid");
    if (!body) return reply;

    return withDomainErrors(reply, async () => {
      const issued = await services.auth.signup(body);
      return replyWithSession(reply, issued, cookieOptions).status(201).send({
        user: toAuthUserDto(issued.user),
      });
    });
  });

  app.post("/api/auth/login", async (request, reply) => {
    const body = loginSchema.safeParse(request.body);
    if (!body.success) {
      // Generic on purpose: a validation error must not reveal which field is wrong.
      return sendError(reply, 401, "invalid_credentials", "email or password is incorrect");
    }
    return withDomainErrors(reply, async () => {
      const issued = await services.auth.login(body.data);
      return replyWithSession(reply, issued, cookieOptions).send({
        user: toAuthUserDto(issued.user),
      });
    });
  });

  /** Idempotent: signing out without a session is a success, not a 401. */
  app.post("/api/auth/logout", async (request, reply) => {
    await services.auth.logout(readSessionCookie(request.headers.cookie));
    return reply
      .header("set-cookie", serializeClearedSessionCookie(cookieOptions))
      .send({ user: null });
  });
}

function replyWithSession(
  reply: FastifyReply,
  issued: IssuedSession,
  options: SessionCookieOptions,
): FastifyReply {
  return reply.header("set-cookie", serializeSessionCookie(issued.token, options));
}
