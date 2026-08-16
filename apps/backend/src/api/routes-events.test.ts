import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { UserAccount } from "../auth/user-account.js";
import type { AppServices } from "../services.js";
import { EventHub } from "../simulation/event-hub.js";
import { registerRoutes } from "./routes.js";

/**
 * Who may subscribe to what (§11.1).
 *
 * The streams stay open, so these tests read the headers and then hang up rather
 * than waiting for a response to end. What each frame contains is fixed in
 * `public-events.test.ts`.
 */
const user: UserAccount = {
  id: "user-1",
  handle: "hanako",
  displayName: "花子",
  description: "",
  email: "hanako@example.com",
  isAdmin: false,
  status: "active",
  interests: [],
};

function makeServices() {
  const events = new EventHub();
  return {
    services: { events } as unknown as AppServices,
    events,
  };
}

async function buildApp(
  services: AppServices,
  currentUser: UserAccount | null,
): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorateRequest("currentUser", null);
  app.addHook("onRequest", async (request) => {
    request.currentUser = currentUser;
  });
  await registerRoutes(app, services);
  await app.ready();
  return app;
}

describe("GET /api/feed/events (§11.1)", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  /** Public, like the feed: an anonymous reader watches threads appear. */
  it("streams to an anonymous subscriber", async () => {
    const { services, events } = makeServices();
    const app = await buildApp(services, null);
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/feed/events",
      payloadAsStream: true,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(events.feedSubscriberCount()).toBe(1);
    response.stream().destroy();
  });

  it("streams to a signed-in subscriber as well", async () => {
    const { services, events } = makeServices();
    const app = await buildApp(services, user);
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/feed/events",
      payloadAsStream: true,
    });

    expect(response.statusCode).toBe(200);
    expect(events.feedSubscriberCount()).toBe(1);
    response.stream().destroy();
  });
});
