import cors from "@fastify/cors";
import { MAX_IMAGE_DATA_URL_LENGTH } from "@enjo/shared";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { registerOpenApi } from "./api/openapi.js";
import { registerRoutes } from "./api/routes.js";
import { env } from "./config/env.js";
import type { Db } from "./persistence/prisma.js";
import { buildServices } from "./services.js";

export async function buildApp(db: Db): Promise<FastifyInstance> {
  const app = Fastify({
    // A 5 MiB image expands when encoded as a JSON data URL.
    bodyLimit: MAX_IMAGE_DATA_URL_LENGTH + 16_384,
    logger: {
      level: env.logLevel,
      // API keys must never reach the logs.
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
  });

  await app.register(cors, {
    origin: env.corsOrigins.includes("*") ? true : env.corsOrigins,
    methods: ["GET", "POST", "PUT", "OPTIONS"],
  });

  await registerOpenApi(app);

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
