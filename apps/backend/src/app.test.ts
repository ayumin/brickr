import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerCors } from "./app.js";

describe("CORS", () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("allows browser preflight requests for character deletion", async () => {
    const app = Fastify();
    apps.push(app);
    await registerCors(app);

    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/characters/character-1?mode=soft",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "DELETE",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toContain("DELETE");
  });
});
