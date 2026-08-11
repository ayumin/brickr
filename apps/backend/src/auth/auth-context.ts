import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendError } from "../api/errors.js";
import type { AuthService } from "./auth-service.js";
import { readSessionCookie } from "./session-cookie.js";
import type { UserAccount } from "./user-account.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Resolved from the session cookie on every request; null when signed out. */
    currentUser: UserAccount | null;
  }
}

/**
 * Attaches the signed-in user to every request (CLAUDE.md §66.11).
 *
 * A single `onRequest` hook covers the SSE endpoint too, which matters because
 * `EventSource` cannot send custom headers and has only the cookie to offer.
 *
 * The hook itself never rejects. Route handlers decide what needs a session,
 * so public reads stay public.
 */
export function registerAuthContext(app: FastifyInstance, auth: AuthService): void {
  app.decorateRequest("currentUser", null);

  app.addHook("onRequest", async (request) => {
    request.currentUser = await auth.resolveSession(readSessionCookie(request.headers.cookie));
  });
}

/**
 * Guard for routes that need a session. Sends 401 and returns null when there
 * is none, so callers read as `const user = requireUser(...); if (!user) return reply;`.
 *
 * A suspended account never resolves to a user (§66.12), so it lands here too.
 */
export function requireUser(request: FastifyRequest, reply: FastifyReply): UserAccount | null {
  const user = request.currentUser;
  if (!user) {
    void sendError(reply, 401, "unauthenticated", "sign in to continue");
    return null;
  }
  return user;
}

/** Guard for admin-only routes (§66.7, §66.15). 401 when signed out, 403 when not admin. */
export function requireAdmin(request: FastifyRequest, reply: FastifyReply): UserAccount | null {
  const user = requireUser(request, reply);
  if (!user) return null;

  if (!user.isAdmin) {
    void sendError(reply, 403, "forbidden", "this action requires an administrator");
    return null;
  }
  return user;
}
