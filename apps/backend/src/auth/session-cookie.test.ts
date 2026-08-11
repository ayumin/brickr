import { SESSION_COOKIE_NAME } from "@brickr/shared";
import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  hashSessionToken,
  readSessionCookie,
  safeTokenEquals,
  serializeClearedSessionCookie,
  serializeSessionCookie,
} from "./session-cookie.js";

describe("session tokens", () => {
  it("issues a different token every time", () => {
    expect(createSessionToken()).not.toEqual(createSessionToken());
  });

  it("hashes deterministically and never returns the raw token", () => {
    const token = createSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(hashSessionToken(token)).not.toBe(token);
  });

  it("compares equal-length tokens without leaking through length mismatch", () => {
    expect(safeTokenEquals("abc", "abc")).toBe(true);
    expect(safeTokenEquals("abc", "abd")).toBe(false);
    expect(safeTokenEquals("abc", "abcd")).toBe(false);
  });
});

describe("session cookie", () => {
  const options = { secure: true, maxAgeSeconds: 3600 };

  it("is httpOnly, Lax and Secure (§66.11)", () => {
    const cookie = serializeSessionCookie("token-value", options);
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=token-value`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Max-Age=3600");
  });

  it("omits Secure over plain http so local development still logs in", () => {
    expect(serializeSessionCookie("t", { ...options, secure: false })).not.toContain("Secure");
  });

  it("expires the cookie on logout", () => {
    const cookie = serializeClearedSessionCookie(options);
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(cookie).toContain("Max-Age=0");
  });
});

describe("readSessionCookie", () => {
  it("finds the session cookie among others", () => {
    expect(readSessionCookie(`theme=dark; ${SESSION_COOKIE_NAME}=abc123; lang=ja`)).toBe("abc123");
  });

  it("tolerates surrounding whitespace", () => {
    expect(readSessionCookie(`  ${SESSION_COOKIE_NAME} = abc123  `)).toBe("abc123");
  });

  it.each([undefined, "", "theme=dark", `${SESSION_COOKIE_NAME}=`, "novaluepair"])(
    "returns null for %p",
    (header) => {
      expect(readSessionCookie(header)).toBeNull();
    },
  );

  it("decodes a percent-encoded value", () => {
    expect(readSessionCookie(`${SESSION_COOKIE_NAME}=a%2Bb`)).toBe("a+b");
  });

  // This runs in the global onRequest hook, so throwing here would turn every
  // request into a 500 for anyone sending one bad cookie.
  it.each(["%", "%zz", "abc%", "%E0%A4%A"])(
    "treats the malformed percent-encoding %p as signed out instead of throwing",
    (value) => {
      expect(() => readSessionCookie(`${SESSION_COOKIE_NAME}=${value}`)).not.toThrow();
      expect(readSessionCookie(`${SESSION_COOKIE_NAME}=${value}`)).toBeNull();
    },
  );
});
