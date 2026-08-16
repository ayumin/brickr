import cors from "@fastify/cors";
import { MAX_IMAGE_DATA_URL_LENGTH } from "@brickr/shared";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { sendError } from "./api/errors.js";
import { registerOpenApi } from "./api/openapi.js";
import { registerRoutes } from "./api/routes.js";
import { AppError } from "./app-error.js";
import { registerAuthContext } from "./auth/auth-context.js";
import { env } from "./config/env.js";
import type { Db } from "./persistence/prisma.js";
import { buildServices } from "./services.js";

export const CORS_METHODS = ["GET", "POST", "PUT", "DELETE", "OPTIONS"];

export async function registerCors(app: FastifyInstance): Promise<void> {
  await app.register(cors, {
    origin: env.corsOrigins.includes("*") ? true : env.corsOrigins,
    methods: CORS_METHODS,
    // The session cookie is sent cross-port in development (5173 -> 3000), so
    // the browser needs this to attach and store it (§66.11).
    credentials: true,
  });
}

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

  await registerCors(app);

  await registerOpenApi(app);

  const services = await buildServices(db, app.log);
  registerAuthContext(app, services.auth);
  await registerRoutes(app, services);

  app.setNotFoundHandler((_request, reply) => sendError(reply, 404, "not_found", "route not found"));

  app.setErrorHandler((error: FastifyError | AppError | Error, request, reply) => {
    request.log.error({ err: error }, "unhandled request error");

    // A known AppError carries its own status, code, and safe message.
    if (error instanceof AppError) {
      return reply.status(error.status).send(error.toResponse());
    }

    const status = (error as FastifyError).statusCode ?? 500;
    // Never leak internal failure detail to the client.
    return sendError(
      reply,
      status,
      "internal_error",
      status < 500 ? error.message : "internal error",
    );
  });

  return app;
}
