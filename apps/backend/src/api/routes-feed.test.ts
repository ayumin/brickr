import type { FeedPageDto } from "@brickr/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserAccount } from "../auth/user-account.js";
import { FeedCursorInvalidError } from "../feed/feed-cursor.js";
import type { AppServices } from "../services.js";
import { registerRoutes } from "./routes.js";

/**
 * The HTTP half of the feed API (§10.1, §10.2, §12.2).
 *
 * What matters here is the boundary: who may call, what a refusal looks like, and
 * which reader the service is told about. The feed's meaning — ordering, paging,
 * capabilities — is fixed in `feed-service.test.ts`.
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

const EMPTY_PAGE: FeedPageDto = { threads: [], nextCursor: null };

function makeServices(overrides: Partial<Record<string, unknown>> = {}) {
  const feed = {
    getUnifiedFeed: vi.fn(() => Promise.resolve(EMPTY_PAGE)),
    getRoomFeed: vi.fn(() => Promise.resolve(EMPTY_PAGE)),
    listThreadReplies: vi.fn(() => Promise.resolve([])),
    ...overrides,
  };
  return { services: { feed } as unknown as AppServices, feed };
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

describe("GET /api/feed (§10.1)", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function start(
    currentUser: UserAccount | null,
    overrides?: Partial<Record<string, unknown>>,
  ) {
    const { services, feed } = makeServices(overrides);
    const app = await buildApp(services, currentUser);
    apps.push(app);
    return { app, feed };
  }

  /** The feed is the one screen an unauthenticated visitor may read (§10.1). */
  it("serves an anonymous reader with no reader identity attached", async () => {
    const { app, feed } = await start(null);

    const response = await app.inject({ method: "GET", url: "/api/feed" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(EMPTY_PAGE);
    expect(feed.getUnifiedFeed).toHaveBeenCalledWith({ reader: null, filter: "all" });
  });

  it("passes the signed-in reader's handle through, since mine matches mentions by handle", async () => {
    const { app, feed } = await start(user);

    await app.inject({ method: "GET", url: "/api/feed?filter=mine" });

    expect(feed.getUnifiedFeed).toHaveBeenCalledWith({
      reader: { id: "user-1", isAdmin: false, handle: "hanako" },
      filter: "mine",
    });
  });

  /**
   * Refused rather than quietly downgraded to `all`: showing a stranger's feed
   * under the "自分あて" tab would look like somebody else's notifications.
   */
  it("answers 401 for filter=mine without a session", async () => {
    const { app, feed } = await start(null);

    const response = await app.inject({ method: "GET", url: "/api/feed?filter=mine" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "unauthenticated" } });
    expect(feed.getUnifiedFeed).not.toHaveBeenCalled();
  });

  it("forwards a cursor unchanged", async () => {
    const { app, feed } = await start(user);

    await app.inject({ method: "GET", url: "/api/feed?cursor=abc.def" });

    expect(feed.getUnifiedFeed).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "abc.def" }),
    );
  });

  it("answers 400 for a cursor it did not issue", async () => {
    const { app } = await start(user, {
      getUnifiedFeed: vi.fn(() => Promise.reject(new FeedCursorInvalidError())),
    });

    const response = await app.inject({ method: "GET", url: "/api/feed?cursor=broken" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "invalid_cursor" } });
  });

  it("answers 400 for an unknown filter", async () => {
    const { app, feed } = await start(user);

    const response = await app.inject({ method: "GET", url: "/api/feed?filter=controversial" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "invalid_query" } });
    expect(feed.getUnifiedFeed).not.toHaveBeenCalled();
  });
});

describe("GET /api/rooms/:id/feed (§10.2)", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function start(currentUser: UserAccount | null) {
    const { services, feed } = makeServices();
    const app = await buildApp(services, currentUser);
    apps.push(app);
    return { app, feed };
  }

  it("requires a session", async () => {
    const { app, feed } = await start(null);
    const response = await app.inject({ method: "GET", url: "/api/rooms/room-1/feed" });
    expect(response.statusCode).toBe(401);
    expect(feed.getRoomFeed).not.toHaveBeenCalled();
  });

  it("passes the room, filter, cursor, and reader to the service", async () => {
    const { app, feed } = await start(user);
    const response = await app.inject({
      method: "GET",
      url: "/api/rooms/room-1/feed?filter=mine&cursor=abc",
    });
    expect(response.statusCode).toBe(200);
    expect(feed.getRoomFeed).toHaveBeenCalledWith("room-1", {
      reader: { id: "user-1", isAdmin: false, handle: "hanako" },
      filter: "mine",
      cursor: "abc",
    });
  });
});

describe("GET /api/posts/:threadRootId/replies (§12.2)", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function start(currentUser: UserAccount | null) {
    const { services, feed } = makeServices();
    const app = await buildApp(services, currentUser);
    apps.push(app);
    return { app, feed };
  }

  /** The feed's two-reply preview is all an anonymous reader gets (§10.8). */
  it("requires a session", async () => {
    const { app, feed } = await start(null);

    const response = await app.inject({ method: "GET", url: "/api/posts/root-1/replies" });

    expect(response.statusCode).toBe(401);
    expect(feed.listThreadReplies).not.toHaveBeenCalled();
  });

  it("returns the replies under the existing posts envelope", async () => {
    const { app, feed } = await start(user);

    const response = await app.inject({ method: "GET", url: "/api/posts/root-1/replies" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ posts: [] });
    expect(feed.listThreadReplies).toHaveBeenCalledWith("root-1", {
      id: "user-1",
      isAdmin: false,
      handle: "hanako",
    });
  });
});

describe("/api/rooms/:id/posts", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function start() {
    const post = { id: "post-1", roomId: "room-1", content: "hello" };
    const requireReadableRoomForPosts = vi.fn(() =>
      Promise.resolve({ room: { id: "room-1" }, canPost: true }),
    );
    const listByRoom = vi.fn(() => Promise.resolve([post]));
    const submitUserPost = vi.fn(() => Promise.resolve(post));
    const buildThreadForReader = vi.fn(() => Promise.resolve({ root: post, replies: [] }));
    const services = {
      roomRuntime: { requireReadableRoomForPosts, submitUserPost },
      posts: { listByRoom },
      feed: { buildThreadForReader },
    } as unknown as AppServices;
    const app = await buildApp(services, user);
    apps.push(app);
    return { app, requireReadableRoomForPosts, listByRoom, submitUserPost };
  }

  it("lists posts through the Room API", async () => {
    const { app, requireReadableRoomForPosts, listByRoom } = await start();
    const response = await app.inject({ method: "GET", url: "/api/rooms/room-1/posts" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      posts: [{ id: "post-1", roomId: "room-1", content: "hello" }],
      canPost: true,
    });
    // Uses the "ForPosts" variant, not `requireReadableRoom` — it must not
    // refuse the reserved Feed room the way the plain room-view path does
    // (see the doc comment on post-routes.ts's handler).
    expect(requireReadableRoomForPosts).toHaveBeenCalledWith("room-1", user);
    expect(listByRoom).toHaveBeenCalledWith("room-1");
  });

  it("creates posts through the Room API", async () => {
    const { app, submitUserPost } = await start();
    const response = await app.inject({
      method: "POST",
      url: "/api/rooms/room-1/posts",
      payload: { content: "hello" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ post: { id: "post-1" } });
    expect(submitUserPost).toHaveBeenCalledWith(expect.objectContaining({
      roomId: "room-1",
      authorId: "user-1",
      content: "hello",
    }));
  });
});
