import { describe, expect, it } from "vitest";
import { LLMError } from "./provider.js";
import {
  httpStatusOf,
  isRetryableStatus,
  messageOf,
  requireClient,
  toLLMError,
} from "./provider-http-error.js";

describe("httpStatusOf", () => {
  it("reads the status field by default", () => {
    expect(httpStatusOf({ status: 429 })).toBe(429);
  });

  it("returns undefined when the field is absent or not a number", () => {
    expect(httpStatusOf({ status: "429" })).toBeUndefined();
    expect(httpStatusOf({})).toBeUndefined();
    expect(httpStatusOf(null)).toBeUndefined();
    expect(httpStatusOf("boom")).toBeUndefined();
  });

  it("checks additional fields in order when given a field list", () => {
    expect(httpStatusOf({ code: 503 }, ["status", "code"])).toBe(503);
    expect(httpStatusOf({ status: 429, code: 503 }, ["status", "code"])).toBe(429);
  });
});

describe("isRetryableStatus", () => {
  it("treats 408/409/429 as retryable", () => {
    expect(isRetryableStatus(408, new Error())).toBe(true);
    expect(isRetryableStatus(409, new Error())).toBe(true);
    expect(isRetryableStatus(429, new Error())).toBe(true);
  });

  it("treats 5xx as retryable and other 4xx as not", () => {
    expect(isRetryableStatus(500, new Error())).toBe(true);
    expect(isRetryableStatus(529, new Error())).toBe(true);
    expect(isRetryableStatus(400, new Error())).toBe(false);
    expect(isRetryableStatus(404, new Error())).toBe(false);
  });

  it("treats an unknown status as retryable unless the error was an abort", () => {
    expect(isRetryableStatus(undefined, new Error("boom"))).toBe(true);
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(isRetryableStatus(undefined, abort)).toBe(false);
  });
});

describe("messageOf", () => {
  it("uses the Error message, or String() for anything else", () => {
    expect(messageOf(new Error("boom"))).toBe("boom");
    expect(messageOf("plain string")).toBe("plain string");
    expect(messageOf(42)).toBe("42");
  });
});

describe("toLLMError", () => {
  it("passes an existing LLMError through unchanged, preserving its retryable flag", () => {
    const original = new LLMError("already normalized", "openai", true);
    expect(toLLMError("openai", "openai", original)).toBe(original);
  });

  it("builds a message with the provider prefix and status when present", () => {
    const sdkError = Object.assign(new Error("rate limited"), { status: 429 });
    const error = toLLMError("openai", "openai", sdkError);
    expect(error).toBeInstanceOf(LLMError);
    expect(error.message).toBe("openai request failed (status 429): rate limited");
    expect(error.providerId).toBe("openai");
    expect(error.retryable).toBe(true);
    expect(error.cause).toBe(sdkError);
  });

  it("omits the status clause when no status is found", () => {
    const error = toLLMError("anthropic", "anthropic", new Error("network down"));
    expect(error.message).toBe("anthropic request failed: network down");
  });

  it("checks the extra status fields passed in for a provider like Gemini", () => {
    const error = toLLMError("gemini", "gemini", { code: 503 }, ["status", "code"]);
    expect(error.message).toContain("(status 503)");
  });
});

describe("requireClient", () => {
  it("returns the client when present", () => {
    const client = { fake: true };
    expect(requireClient(client, "openai")).toBe(client);
  });

  it("throws a non-retryable LLMError naming the provider when absent", () => {
    expect(() => requireClient(undefined, "openai")).toThrow(LLMError);
    try {
      requireClient(undefined, "openai");
      throw new Error("expected requireClient to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(LLMError);
      expect((error as LLMError).message).toBe("openai is not configured (missing API key)");
      expect((error as LLMError).retryable).toBe(false);
    }
  });
});
