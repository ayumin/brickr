import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { SESSION_COOKIE_NAME } from "@brickr/shared";

/**
 * Opaque session tokens and the cookie they travel in (CLAUDE.md §66.11).
 *
 * Written by hand rather than pulled from a cookie plugin: one cookie, two
 * operations, and §60 asks us not to grow the dependency list for that.
 *
 * CSRF relies on `SameSite=Lax` alone (§66.11). No double-submit token.
 */

export type SessionCookieOptions = {
  /** Off in local http development, on everywhere a browser sees https. */
  secure: boolean;
  maxAgeSeconds: number;
};

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only the digest is stored, so the database never holds a usable credential. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export function safeTokenEquals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function serializeSessionCookie(
  token: string,
  options: SessionCookieOptions,
): string {
  return buildCookie(token, options.maxAgeSeconds, options.secure);
}

/** Same attributes as the original cookie, so the browser actually replaces it. */
export function serializeClearedSessionCookie(options: SessionCookieOptions): string {
  return buildCookie("", 0, options.secure);
}

function buildCookie(value: string, maxAgeSeconds: number, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Reads our cookie out of a `Cookie` header. Unknown pairs and stray whitespace
 * are ignored; a malformed header yields `null` rather than an error.
 */
export function readSessionCookie(header: string | undefined): string | null {
  if (!header) return null;

  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;

    const name = pair.slice(0, separator).trim();
    if (name !== SESSION_COOKIE_NAME) continue;

    const value = pair.slice(separator + 1).trim();
    return value.length > 0 ? decodeURIComponent(value) : null;
  }
  return null;
}
