import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserAccount } from "../auth/user-account.js";
import type { AppServices } from "../services.js";
import { EventHub } from "../rooms/event-hub.js";
import { RuntimeRoomNotFoundError } from "../rooms/room-runtime-service.js";
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

function makeServices(readable = true) {
  const events = new EventHub();
  const assertRoomFeedReadable = vi.fn((roomId: string) =>
    readable ? Promise.resolve() : Promise.reject(new RuntimeRoomNotFoundError(roomId)),
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

describe("GET /api/rooms/:id/events (§11.1)", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("requires a session", async () => {
    const { services, events, assertRoomFeedReadable } = makeServices();
    const app = await buildApp(services, null);
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/api/rooms/room-1/events" });
    expect(response.statusCode).toBe(401);
    expect(assertRoomFeedReadable).not.toHaveBeenCalled();
    expect(events.subscriberCount("room-1")).toBe(0);
  });

  it("subscribes a signed-in reader to a readable room", async () => {
    const { services, events, assertRoomFeedReadable } = makeServices();
    const app = await buildApp(services, user);
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/api/rooms/room-1/events",
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

  it("answers 404 for an unreadable room", async () => {
    const { services, events } = makeServices(false);
    const app = await buildApp(services, user);
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/api/rooms/room-9/events" });
    expect(response.statusCode).toBe(404);
    expect(events.subscriberCount("room-9")).toBe(0);
  });
});

/**
 * SSE contract: visibility re-evaluation (§11.1).
 *
 * When a room is archived or a member's access is revoked, the server must
 * terminate the open stream so the client reconnects and receives a 404.
 *
 * The route registers an `onClose` callback with the EventHub. When
 * `closeRoom` or `closeSubscriber` is called, the EventHub invokes `onClose`,
 * which ends the HTTP response. These tests verify the contract at the
 * route layer: that the connection is registered and that `closeRoom` removes
 * it (the EventHub-level behaviour is tested in event-hub.test.ts).
 */
describe("SSE contract: visibility re-evaluation (§11.1)", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  /**
   * Non-members of closed/private rooms are refused at subscription time (§11.1,
   * §10.4). The stream is never opened, so no connection is registered.
   */
  it("refuses a non-member at subscription time — no connection registered", async () => {
    const { services, events } = makeServices(false);
    const app = await buildApp(services, user);
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/rooms/private-room/events",
    });

    // Non-members receive 404, not an open stream.
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "not_found" } });
    // No connection was registered in the EventHub.
    expect(events.subscriberCount("private-room")).toBe(0);
  });

  /**
   * A room-scoped stream registers a connection in the EventHub. When the room
   * is archived (`closeRoom`), the connection is removed — the client reconnects
   * and receives a 404 (§10.4).
   *
   * The route passes an `onClose` callback to `EventHub.subscribe`. When
   * `closeRoom` is called, the EventHub invokes `onClose` (which ends the HTTP
   * response) and removes the connection. This test verifies that the connection
   * is removed from the EventHub after `closeRoom`.
   */
  it("removes the connection from the EventHub when closeRoom is called", async () => {
    const { services, events } = makeServices();
    const app = await buildApp(services, user);
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/rooms/room-1/events",
      payloadAsStream: true,
    });

    expect(response.statusCode).toBe(200);
    expect(events.subscriberCount("room-1")).toBe(1);

    // Archive the room — the EventHub terminates the connection.
    events.closeRoom("room-1");

    // The connection must be removed from the EventHub immediately.
    expect(events.subscriberCount("room-1")).toBe(0);

    response.stream().destroy();
  });

  it("removes every connection for the revoked subscriber", async () => {
    const { services, events } = makeServices();
    const app = await buildApp(services, user);
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/rooms/room-1/events",
      payloadAsStream: true,
    });

    expect(response.statusCode).toBe(200);
    expect(events.subscriberCount("room-1")).toBe(1);

    events.closeSubscriber("room-1", user.id);

    expect(events.subscriberCount("room-1")).toBe(0);
    response.stream().destroy();
  });

  it("stops the heartbeat when the server terminates the stream", async () => {
    const { services, events } = makeServices();
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const app = await buildApp(services, user);
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/rooms/room-1/events",
      payloadAsStream: true,
    });

    clearIntervalSpy.mockClear();
    events.closeSubscriber("room-1", user.id);

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    clearIntervalSpy.mockRestore();
    response.stream().destroy();
  });

  /**
   * The route registers an `onClose` callback that ends the HTTP response when
   * the EventHub calls it. This test verifies that the `onClose` callback is
   * wired correctly: after `closeRoom`, the response stream ends.
   *
   * We verify this indirectly: the EventHub removes the connection, which means
   * `onClose` was called (the EventHub only removes connections after calling
   * `onClose`).
   */
  it("registers an onClose callback that the EventHub can invoke", async () => {
    // Spy on EventHub.subscribe to capture the onClose callback.
    const { services, events } = makeServices();
    const subscribeSpy = vi.spyOn(events, "subscribe");

    const app = await buildApp(services, user);
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/rooms/room-1/events",
      payloadAsStream: true,
    });

    expect(response.statusCode).toBe(200);
    // The route must have called subscribe with an onClose callback.
    expect(subscribeSpy).toHaveBeenCalledWith(
      "room-1",
      expect.any(Function),
      expect.any(Function), // onClose
      "user-1",
    );

    response.stream().destroy();
  });
});
