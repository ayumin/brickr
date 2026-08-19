import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import { handleDomainError, sendError } from "./errors.js";
import { idParams } from "./schemas.js";

type ParseErrorCode = "invalid_params" | "invalid_query" | "invalid_body";

/**
 * Parses one part of a request, or answers 400 and returns null, so callers
 * read like the auth guards: `const body = parseOr400(...); if (!body) return reply;`
 *
 * `invalid_params` omits the Zod issues: a bad path segment (an id that isn't
 * a UUID, say) has nothing useful to report back, matching every current
 * params-parsing call site. Body and query include them.
 */
export function parseOr400<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
  reply: FastifyReply,
  code: ParseErrorCode,
  message: string,
): z.output<Schema> | null {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  sendError(reply, 400, code, message, code === "invalid_params" ? undefined : result.error.issues);
  return null;
}

/** Runs a handler and turns any `DomainError` it raises into its HTTP answer. */
export async function withDomainErrors<T>(
  reply: FastifyReply,
  handler: () => Promise<T>,
): Promise<T | FastifyReply> {
  try {
    return await handler();
  } catch (error) {
    return handleDomainError(reply, error);
  }
}

/** Shared param parsing + domain-error mapping for room-scoped routes. */
export async function withRoom<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  handler: (id: string) => Promise<T>,
): Promise<T | FastifyReply> {
  const params = parseOr400(
    idParams,
    request.params,
    reply,
    "invalid_params",
    "room id is invalid",
  );
  if (!params) return reply;

  return withDomainErrors(reply, () => handler(params.id));
}
