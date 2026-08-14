import type { ApiErrorBody, ApiErrorCode } from "@brickr/shared";
import type { FastifyReply } from "fastify";

export function sendError(
  reply: FastifyReply,
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): FastifyReply {
  const body: ApiErrorBody = {
    error: { code, message, ...(details === undefined ? {} : { details }) },
  };
  return reply.status(status).send(body);
}
