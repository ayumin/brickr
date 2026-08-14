import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/auth-context.js";
import type { AppServices } from "../services.js";
import { sendError } from "./errors.js";
import { toFeedReader } from "./feed-reader.js";
import { parseOr400, withDomainErrors, withSimulation } from "./route-helpers.js";
import { createPostSchema, idParams, threadRootParams } from "./schemas.js";

export function registerPostRoutes(app: FastifyInstance, services: AppServices): void {
  app.get("/api/simulations/:id/posts", async (request, reply) =>
    withSimulation(request, reply, async (id) => ({
      posts: await services.posts.listBySimulation(id),
    })),
  );

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

      return reply.status(201).send({ post: await services.posts.toDto(post) });
    });
  });

  app.get("/api/posts/:id", async (request, reply) => {
    const params = parseOr400(idParams, request.params, reply, "invalid_params", "post id is invalid");
    if (!params) return reply;

    const post = await services.posts.findById(params.id);
    if (!post) return sendError(reply, 404, "not_found", "post not found");

    return { post: await services.posts.toDto(post) };
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
