import type { ApiErrorBody, ApiErrorCode } from "@brickr/shared";
import type { FastifyReply } from "fastify";
import { DomainError } from "../domain-error.js";

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

/**
 * Maps a thrown `DomainError` to its HTTP answer. Any other error is rethrown
 * so it reaches Fastify's error handler and answers 500 (CLAUDE.md §55) —
 * a caller-caused failure is the only kind this function knows how to answer.
 */
export function handleDomainError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof DomainError) {
    return sendError(reply, error.httpStatus, error.errorCode, error.message);
  }
  throw error;
}
