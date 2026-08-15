import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/auth-context.js";
import type { AppServices } from "../services.js";
import { sendError } from "./errors.js";
import { toFeedReader } from "./feed-reader.js";
import { parseOr400, withDomainErrors, withSimulation } from "./route-helpers.js";
import { createPostSchema, idParams, threadRootParams } from "./schemas.js";

export function registerPostRoutes(app: FastifyInstance, services: AppServices): void {
  /**
   * One simulation's posts in full — the room's, or the global feed's when a
   * post detail's thread lives there (§10.8). Login required, and a stopped
   * room stays refused for anyone but its creator or an administrator, same as
   * the room detail — but unlike the room detail, the global row is not
   * refused: `PostDetailScreen` is this route's only remaining caller, and it
   * needs every post in a thread regardless of which simulation the thread is
   * in, not a "this is a real room" check (`requireReadableSimulation`, not
   * `requireReadableRoom`).
   *
   * The paged feed (`GET /api/simulations/:id/feed`) is what the UI otherwise reads.
   */
  app.get("/api/simulations/:id/posts", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    return withSimulation(request, reply, async (id) => {
      await services.simulations.requireReadableSimulation(id, user);
      return { posts: await services.posts.listBySimulation(id) };
    });
  });

  app.post("/api/simulations/:id/posts", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    const params = parseOr400(idParams, request.params, reply, "invalid_params", "simulation id is invalid");
    if (!params) return reply;

    const body = parseOr400(createPostSchema, request.body, reply, "invalid_body", "post body is invalid");
    if (!body) return reply;

    return withDomainErrors(reply, async () => {
      const post = await services.simulations.submitUserPost({
        simulationId: params.id,
        authorId: user.id,
        content: body.content,
        imageUrl: body.imageUrl,
        responderIds: body.responderIds ?? [],
        replyTo: body.replyTo ?? null,
        quoteOf: body.quoteOf ?? null,
      });

      // The thread as well as the post (§13.4): the feed keys on `thread.root.id`,
      // so the client can show its own post at once and let the stream's echo of
      // it land on the same entry instead of a duplicate.
      // `thread.root` is already the DTO for the just-created post, so reuse it
      // directly rather than mapping the same post a second time via `toDto`.
      const thread = await services.feed.buildThreadForReader(post, toFeedReader(user));

      return reply.status(201).send({ post: thread.root, thread });
    });
  });

  /**
   * One post, with the same anonymous author shape the feed uses (§10.8).
   *
   * Login required: everything an anonymous reader needs is already in the
   * `/api/feed` response, so the post detail is not part of the public surface.
   *
   * A post in a stopped room is readable by that room's creator and by an
   * administrator, and is a 404 — not a 403 — for everybody else. The service
   * returns the same `null` for "no such post" and "not for you", so the two
   * cannot be told apart from out here.
   */
  app.get("/api/posts/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    const params = parseOr400(idParams, request.params, reply, "invalid_params", "post id is invalid");
    if (!params) return reply;

    const post = await services.feed.findVisiblePost(params.id, toFeedReader(user));
    if (!post) return sendError(reply, 404, "not_found", "post not found");

    return { post };
  });

  /**
   * The replies the feed left out (§12.2). Login required, like the thread detail
   * it belongs to: the feed's own preview is all an anonymous reader gets (§10.8).
   */
  app.get("/api/posts/:threadRootId/replies", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    const params = parseOr400(
      threadRootParams,
      request.params,
      reply,
      "invalid_params",
      "thread root id is invalid",
    );
    if (!params) return reply;

    return withDomainErrors(reply, async () => ({
      posts: await services.feed.listThreadReplies(params.threadRootId, toFeedReader(user)),
    }));
  });
}
