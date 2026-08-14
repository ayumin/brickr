import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/auth-context.js";
import type { AppServices } from "../services.js";
import { sendError } from "./errors.js";
import { toFeedReader } from "./feed-reader.js";
import { parseOr400, withDomainErrors, withSimulation } from "./route-helpers.js";
import { createPostSchema, idParams, threadRootParams } from "./schemas.js";

export function registerPostRoutes(app: FastifyInstance, services: AppServices): void {
  /**
   * One room's posts in full. Login required, and under the same room access rule
   * as the room itself (§10.4, §10.8) — otherwise the 404 the room detail gives
   * for somebody else's stopped room would be undone by reading its posts here.
   *
   * The paged feed (`GET /api/simulations/:id/feed`) is what the UI reads.
   */
  app.get("/api/simulations/:id/posts", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    return withSimulation(request, reply, async (id) => {
      await services.simulations.requireReadableRoom(id, user);
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
      const [dto, thread] = await Promise.all([
        services.posts.toDto(post),
        services.feed.buildThreadForReader(post, toFeedReader(user)),
      ]);

      return reply.status(201).send({ post: dto, thread });
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
