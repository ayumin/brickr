import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { api, request, simulationEventsUrl, API_BASE_URL } from "./api-client";

describe("api-client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("request path validation - SSRF prevention", () => {
    it("should reject paths that do not start with /api/", async () => {
      const invalidPaths = [
        "relative/path",
        "/health",
        "api/health",
        "../../../etc/passwd",
      ];

      for (const path of invalidPaths) {
        try {
          await request(path);
          expect.fail(`Path "${path}" should have been rejected`);
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toContain("Invalid API path");
        }
        expect(fetchMock).not.toHaveBeenCalled();
      }
    });

    it("should reject absolute URLs (http://)", async () => {
      try {
        await request("http://evil.com/steal");
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("Invalid API path");
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should reject absolute URLs (https://)", async () => {
      try {
        await request("https://evil.com/steal");
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("Invalid API path");
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should reject protocol-relative URLs (//)", async () => {
      try {
        await request("//evil.com/steal");
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("Invalid API path");
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should reject paths with :// (protocol indicators)", async () => {
      try {
        await request("/api/data?url=ftp://evil.com");
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("protocol");
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should reject paths attempting to access external domains", async () => {
      try {
        await request("https://external-domain.com/api");
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("Invalid API path");
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should reject paths attempting to access localhost", async () => {
      try {
        await request("http://localhost:9999/secret");
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("Invalid API path");
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should reject paths attempting to access internal IPs", async () => {
      try {
        await request("http://192.168.1.1/admin");
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("Invalid API path");
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("valid API calls", () => {
    it("should accept valid API paths starting with /api/", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "ok" }),
      });

      const result = await api.health();

      expect(result).toEqual({ status: "ok" });
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("should successfully call /api/health", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "ok" }),
      });

      const result = await api.health();

      expect(result).toEqual({ status: "ok" });
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("should successfully call /api/characters", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ characters: [] }),
      });

      const result = await api.getCharacters();

      expect(result).toEqual([]);
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("should successfully call /api/application-settings", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ settings: {} }),
      });

      const result = await api.getApplicationSettings();

      expect(result).toEqual({ settings: {} });
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("should accept paths with encoded parameters", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ character: { id: "test-id", name: "Test" } }),
      });

      const result = await api.getCharacter("test-id");

      expect(result).toEqual({ id: "test-id", name: "Test" });
      expect(fetchMock).toHaveBeenCalledOnce();
      const callUrl = (fetchMock.mock.calls[0] as unknown[])[0] as string;
      expect(callUrl).toContain("/api/characters/test-id");
    });

    it("should properly encode special characters in paths", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ character: { id: "test id", name: "Test" } }),
      });

      const result = await api.getCharacter("test id");

      expect(result).toEqual({ id: "test id", name: "Test" });
      expect(fetchMock).toHaveBeenCalledOnce();
      const callUrl = (fetchMock.mock.calls[0] as unknown[])[0] as string;
      expect(callUrl).toContain("/api/characters/test%20id");
    });

    it("should accept paths with query parameters", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ deletedId: "test-id" }),
      });

      const result = await api.deleteCharacter("test-id", "soft");

      expect(result).toBe("test-id");
      expect(fetchMock).toHaveBeenCalledOnce();
      const callUrl = (fetchMock.mock.calls[0] as unknown[])[0] as string;
      expect(callUrl).toContain("/api/characters/test-id");
      expect(callUrl).toContain("mode=soft");
    });
  });

  describe("simulationEventsUrl function", () => {
    it("should construct valid SSE URLs with proper encoding", () => {
      const url = simulationEventsUrl("test-simulation-123");
      expect(url).toBe(`${API_BASE_URL}/api/simulations/test-simulation-123/events`);
    });

    it("should properly encode special characters in simulation IDs", () => {
      const url = simulationEventsUrl("test/simulation?id=123");
      expect(url).toContain(encodeURIComponent("test/simulation?id=123"));
      expect(url).not.toContain("test/simulation?id=123");
    });

    it("should prevent SSRF attacks through simulation ID parameter", () => {
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
