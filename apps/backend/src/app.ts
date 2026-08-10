import cors from "@fastify/cors";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { registerRoutes } from "./api/routes.js";
import { env } from "./config/env.js";
import type { Db } from "./persistence/prisma.js";
import { buildServices } from "./services.js";

export async function buildApp(db: Db): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.logLevel,
      // API keys must never reach the logs.
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
  });

  await app.register(cors, {
    origin: env.corsOrigins.includes("*") ? true : env.corsOrigins,
    methods: ["GET", "POST", "OPTIONS"],
  });

  const services = buildServices(db, app.log);
  await registerRoutes(app, services);

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: { code: "not_found", message: "route not found" } });
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, "unhandled request error");
    const status = error.statusCode ?? 500;
    reply.status(status).send({
      error: {
        code: "internal_error",
        // Never leak internal failure detail to the client.
        message: status < 500 ? error.message : "internal error",
      },
    });
  });

  return app;
}
