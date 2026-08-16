import type { ApiErrorBody, ApiErrorCode } from "@brickr/shared";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

/**
 * A concrete, directly-instantiable application error that carries everything
 * needed to produce a well-formed API error envelope.
 *
 * Use this when you want to raise a known failure without defining a new
 * `DomainError` subclass — for example, inside route handlers or middleware
 * where the HTTP status and code are already obvious at the call site.
 *
 * The global error handler in `app.ts` catches `AppError` and calls
 * `toResponse()` to build the `{ error: { code, message, details? } }`
 * envelope. Unknown errors that are not `AppError` instances are answered
 * with a safe 500 `internal_error` envelope so that no internal detail leaks
 * to the client.
 *
 * `details` must never contain sensitive information (passwords, tokens, PII).
 * In production, consider whether `message` itself reveals too much to an
 * attacker; prefer generic messages for 5xx responses.
 */
export class AppError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }

  toResponse(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined && { details: this.details }),
      },
    };
  }
}

/**
 * Fastify error handler that converts `AppError` instances into their defined
 * HTTP status + error envelope, and maps every other exception to a safe 500
 * `internal_error` response so that no internal detail leaks to the client.
 *
 * Extracted here (independent of Prisma) so that both `app.ts` and the test
 * suite can import the same function and the tests validate the real
 * production code path.
 */
export function appErrorHandler(
  error: unknown,
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof AppError) {
    reply.status(error.status).send(error.toResponse());
    return;
  }

  const status = (error as FastifyError).statusCode ?? 500;
  reply.status(status).send({
    error: {
      code: "internal_error",
      message: status < 500 ? error.message : "internal error",
    },
  });
}
