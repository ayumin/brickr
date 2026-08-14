import { GLOBAL_SIMULATION_ID } from "@brickr/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserAccount } from "../auth/user-account.js";
import type { AppServices } from "../services.js";
import { EventHub } from "../simulation/event-hub.js";
import { SimulationNotFoundError } from "../simulation/simulation-service.js";
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

function makeServices(options: { readable?: boolean } = {}) {
  const events = new EventHub();
  const assertRoomFeedReadable = vi.fn((simulationId: string) =>
    options.readable === false
      ? Promise.reject(new SimulationNotFoundError(simulationId))
      : Promise.resolve(),
  );

  return {
    services: { events, feed: { assertRoomFeedReadable } } as unknown as AppServices,
    events,
    assertRoomFeedReadable,
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

describe("GET /api/simulations/:id/events (§11.1, §10.4)", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  /**
   * Without this, subscribing would say that a room exists and when it is busy —
   * exactly what the REST read refuses to reveal.
   */
  it("refuses an anonymous subscriber", async () => {
    const { services, events, assertRoomFeedReadable } = makeServices();
    const app = await buildApp(services, null);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/simulations/room-1/events" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "unauthenticated" } });
    expect(assertRoomFeedReadable).not.toHaveBeenCalled();
    expect(events.subscriberCount("room-1")).toBe(0);
  });

  it("subscribes a signed-in reader to a room it may read", async () => {
    const { services, events, assertRoomFeedReadable } = makeServices();
    const app = await buildApp(services, user);
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/simulations/room-1/events",
      payloadAsStream: true,
    });

    expect(response.statusCode).toBe(200);
    expect(assertRoomFeedReadable).toHaveBeenCalledWith("room-1", {
      id: "user-1",
      isAdmin: false,
      handle: "hanako",
    });
    expect(events.subscriberCount("room-1")).toBe(1);
    response.stream().destroy();
  });

  it("answers 404 for a room the reader may not read", async () => {
    const { services, events } = makeServices({ readable: false });
    const app = await buildApp(services, user);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/simulations/room-9/events" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "not_found" } });
    expect(events.subscriberCount("room-9")).toBe(0);
  });

  /** The global row is the feed; its stream is `/api/feed/events`. */
  it("answers 404 for the reserved global simulation", async () => {
    const { services } = makeServices({ readable: false });
    const app = await buildApp(services, user);
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: `/api/simulations/${GLOBAL_SIMULATION_ID}/events`,
    });

    expect(response.statusCode).toBe(404);
  });
});
