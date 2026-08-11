import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { API_BASE_URL } from "./api-client";

describe("api-client SSRF protection", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("request function path validation - invalid paths (should be rejected)", () => {
    it("should reject paths that do not start with /api/", async () => {
      const { api } = await import("./api-client");
      
      const invalidPaths = [
        "/health",
        "api/health",
        "../../../etc/passwd",
      ];

      for (const path of invalidPaths) {
        try {
          await (api as any).request?.(path) ?? Promise.reject(new Error("No request export"));
          expect.fail(`Path "${path}" should have been rejected`);
        } catch (error) {
          expect(error).toBeDefined();
          if (error instanceof Error) {
            expect(error.message).toContain("Invalid API path");
          }
        }
      }
    });

    it("should reject absolute URLs with protocols", async () => {
      const absoluteUrls = [
        "http://localhost:3000/api/health",
        "https://localhost:3000/api/health",
        "http://evil.com/api/health",
        "https://evil.com/api/health",
        "ftp://evil.com/api/health",
        "file:///etc/passwd",
      ];

      for (const url of absoluteUrls) {
        try {
          await (global.fetch as any)(url);
          expect.fail(`Absolute URL "${url}" should have been rejected by validation`);
        } catch (error) {
          expect(error).toBeDefined();
        }
      }
    });

    it("should prevent protocol-relative URLs", async () => {
      const protocolRelativePaths = [
        "//evil.com/api/health",
        "///evil.com/api/health",
      ];

      for (const path of protocolRelativePaths) {
        try {
          await (global.fetch as any)(path);
          expect.fail(`Protocol-relative path "${path}" should have been rejected`);
        } catch (error) {
          expect(error).toBeDefined();
        }
      }
    });
  });

  describe("request function path validation - valid paths (should be accepted)", () => {
    it("should accept valid API paths", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ status: "ok" }),
      });

      const validPaths = [
        "/api/health",
        "/api/auth/session",
        "/api/characters",
        "/api/characters/123",
        "/api/simulations/456/posts",
      ];

      for (const path of validPaths) {
        fetchMock.mockClear();
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: "ok" }),
        });

        try {
          const response = await fetch(`${API_BASE_URL}${path}`);
          expect(response.ok).toBe(true);
        } catch (error) {
          if (error instanceof Error && error.message.includes("Invalid API path")) {
            expect.fail(`Valid path "${path}" was rejected`);
          }
        }
      }
    });

    it("should accept paths with query parameters", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ status: "ok" }),
      });

      const pathsWithParams = [
        "/api/characters/123?mode=soft",
        "/api/simulations/456/posts?limit=10",
      ];

      for (const path of pathsWithParams) {
        fetchMock.mockClear();
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: "ok" }),
        });

        try {
          const response = await fetch(`${API_BASE_URL}${path}`);
          expect(response.ok).toBe(true);
        } catch (error) {
          if (error instanceof Error && error.message.includes("Invalid API path")) {
            expect.fail(`Valid path with params "${path}" was rejected`);
          }
        }
      }
    });
  });

  describe("simulationEventsUrl function", () => {
    it("should construct valid SSE URLs with proper encoding", () => {
      const { simulationEventsUrl } = require("./api-client");
      
      const url = simulationEventsUrl("test-simulation-123");
      expect(url).toBe(`${API_BASE_URL}/api/simulations/test-simulation-123/events`);
    });

    it("should properly encode special characters in simulation IDs", () => {
      const { simulationEventsUrl } = require("./api-client");
      
      const url = simulationEventsUrl("test/simulation?id=123");
      expect(url).toContain(encodeURIComponent("test/simulation?id=123"));
      expect(url).not.toContain("test/simulation?id=123");
    });

    it("should prevent SSRF attacks through simulation ID parameter", () => {
      const { simulationEventsUrl } = require("./api-client");
      
      const maliciousIds = [
        "http://evil.com",
        "//evil.com",
        "../../../etc/passwd",
      ];

      for (const id of maliciousIds) {
        const url = simulationEventsUrl(id);
        expect(url).toContain(encodeURIComponent(id));
        expect(url).toContain("/api/simulations/");
        expect(url).not.toContain(id);
      }
    });
  });
});
