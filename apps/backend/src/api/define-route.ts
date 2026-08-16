import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { OpenAPIV3 } from "openapi-types";
import { z } from "zod";
import { requireUser } from "../auth/auth-context.js";
import type { UserAccount } from "../auth/user-account.js";
import { handleDomainError, sendError } from "./errors.js";
import { requestSchema } from "./openapi-schemas.js";

/**
 * Auth requirement for a route.
 *
 * - `"required"` — 401 when signed out; `ctx.user` is always a `UserAccount`.
 * - `"optional"` — resolves the session if present; `ctx.user` may be null.
 * - `"none"`     — no session check; `ctx.user` is always null.
 */
export type AuthMode = "required" | "optional" | "none";

/**
 * The context passed to every route handler.
 *
 * `user` is typed according to the `auth` field of the route definition:
 * - `"required"` → `UserAccount`
 * - `"optional"` → `UserAccount | null`
 * - `"none"`     → null
 */
export type RouteContext<
  Auth extends AuthMode,
  P = undefined,
  Q = undefined,
  B = undefined,
> = {
  user: Auth extends "required" ? UserAccount : Auth extends "optional" ? UserAccount | null : null;
  params: P extends undefined ? Record<string, never> : P;
  query: Q extends undefined ? Record<string, never> : Q;
  body: B extends undefined ? Record<string, never> : B;
  request: FastifyRequest;
  reply: FastifyReply;
};

/**
 * Route definition passed to `defineRoute`.
 *
 * All schemas are Zod schemas; the handler receives already-parsed, typed
 * values. The `response` schema is used only for OpenAPI documentation — the
 * handler's return value is sent as-is, so the schema must match what the
 * handler actually returns.
 */
export type RouteDefinition<
  Auth extends AuthMode,
  P extends z.ZodType | undefined,
  Q extends z.ZodType | undefined,
  B extends z.ZodType | undefined,
  R extends z.ZodType,
> = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  auth: Auth;
  params?: P;
  query?: Q;
  body?: B;
  response: R;
  handler: (
    ctx: RouteContext<
      Auth,
      P extends z.ZodType ? z.output<P> : undefined,
      Q extends z.ZodType ? z.output<Q> : undefined,
      B extends z.ZodType ? z.output<B> : undefined
    >,
  ) => Promise<z.input<R>>;
};

/**
 * OpenAPI metadata that can be attached to a route definition.
 *
 * Kept separate from `RouteDefinition` so the core type stays minimal and
 * the documentation layer is opt-in.
 */
export type RouteOpenApiMeta = {
  operationId: string;
  tags?: string[];
  summary?: string;
  description?: string;
  /** Extra path parameters not covered by the `params` schema (e.g. path segments). */
  extraParameters?: OpenAPIV3.ParameterObject[];
  /** Override the default 200 success response description. */
  successDescription?: string;
  /** Additional response codes beyond the defaults. */
  extraResponses?: Record<string, OpenAPIV3.ResponseObject | OpenAPIV3.ReferenceObject>;
  /** Security requirement; defaults to `[{ cookieAuth: [] }]` when auth !== "none". */
  security?: OpenAPIV3.SecurityRequirementObject[];
};

/**
 * A registered route: the definition plus its derived OpenAPI operation.
 *
 * Collected by `defineRoute` so the OpenAPI document can be assembled from
 * the same source that drives the actual handlers.
 */
export type RegisteredRoute = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  openApiPath: string;
  operation: OpenAPIV3.OperationObject;
};

/** All routes registered via `defineRoute`, in registration order. */
export const registeredRoutes: RegisteredRoute[] = [];

const jsonBody = (
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
  required = true,
): OpenAPIV3.RequestBodyObject => ({
  required,
  content: { "application/json": { schema } },
});

const jsonResponse = (
  description: string,
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
): OpenAPIV3.ResponseObject => ({
  description,
  content: { "application/json": { schema } },
});

const sessionSecurity: OpenAPIV3.SecurityRequirementObject[] = [{ cookieAuth: [] }];

/**
 * Converts a Fastify-style path (`:id`) to an OpenAPI-style path (`{id}`).
 */
function toOpenApiPath(fastifyPath: string): string {
  return fastifyPath.replace(/:([A-Za-z0-9_]+)/gu, "{$1}");
}

/**
 * Derives OpenAPI parameter objects from a Zod params schema.
 *
 * Only handles flat `z.object()` schemas whose properties are all scalars —
 * which is all path-parameter schemas in this codebase.
 */
function paramsToOpenApi(schema: z.ZodType): OpenAPIV3.ParameterObject[] {
  const converted = requestSchema(schema) as {
    properties?: Record<string, OpenAPIV3.SchemaObject>;
    required?: string[];
  };
  if (!converted.properties) return [];

  return Object.entries(converted.properties).map(([name, propSchema]) => ({
    name,
    in: "path" as const,
    required: true,
    schema: propSchema,
  }));
}

/**
 * Derives OpenAPI query parameter objects from a Zod query schema.
 */
function queryToOpenApi(schema: z.ZodType): OpenAPIV3.ParameterObject[] {
  const converted = requestSchema(schema) as {
    properties?: Record<string, OpenAPIV3.SchemaObject>;
    required?: string[];
  };
  if (!converted.properties) return [];

  const required = new Set(converted.required ?? []);
  return Object.entries(converted.properties).map(([name, propSchema]) => ({
    name,
    in: "query" as const,
    required: required.has(name),
    schema: propSchema,
  }));
}

/**
 * Builds an OpenAPI operation object from a route definition and metadata.
 *
 * Exported so that route files can call it at module load time to register
 * their operations in `registeredRoutes` independently of handler binding.
 */
export function buildOpenApiOperation<
  Auth extends AuthMode,
  P extends z.ZodType | undefined,
  Q extends z.ZodType | undefined,
  B extends z.ZodType | undefined,
  R extends z.ZodType,
>(
  definition: Pick<RouteDefinition<Auth, P, Q, B, R>, "method" | "path" | "auth" | "params" | "query" | "body" | "response">,
  meta: RouteOpenApiMeta,
): void {
  const parameters: OpenAPIV3.ParameterObject[] = [
    ...(definition.params ? paramsToOpenApi(definition.params) : []),
    ...(definition.query ? queryToOpenApi(definition.query) : []),
    ...(meta.extraParameters ?? []),
  ];

  const responseSchema = requestSchema(definition.response);

  const defaultResponses: OpenAPIV3.ResponsesObject = {
    "200": jsonResponse(meta.successDescription ?? "Success", responseSchema),
    "400": { $ref: "#/components/responses/BadRequest" },
    "500": { $ref: "#/components/responses/InternalError" },
  };

  if (definition.auth !== "none") {
    defaultResponses["401"] = { $ref: "#/components/responses/Unauthorized" };
  }

  const operation: OpenAPIV3.OperationObject = {
    operationId: meta.operationId,
    ...(meta.tags ? { tags: meta.tags } : {}),
    ...(meta.summary ? { summary: meta.summary } : {}),
    ...(meta.description ? { description: meta.description } : {}),
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(definition.body
      ? { requestBody: jsonBody(requestSchema(definition.body)) }
      : {}),
    ...(definition.auth !== "none"
      ? { security: meta.security ?? sessionSecurity }
      : {}),
    responses: {
      ...defaultResponses,
      ...(meta.extraResponses ?? {}),
    },
  };

  registeredRoutes.push({
    method: definition.method,
    path: definition.path,
    openApiPath: toOpenApiPath(definition.path),
    operation,
  });
}

/**
 * Declares a route with unified auth, Zod validation, AppError conversion, and
 * OpenAPI documentation derived from the same schemas that drive the handler.
 *
 * Usage:
 * ```ts
 * const myRoute = defineRoute({
 *   method: "GET",
 *   path: "/api/things/:id",
 *   auth: "required",
 *   params: z.object({ id: z.string().min(1) }),
 *   response: z.object({ thing: z.object({ id: z.string() }) }),
 *   handler: async ({ user, params }) => {
 *     return { thing: await service.get(params.id, user) };
 *   },
 * });
 *
 * // Register on a Fastify instance:
 * myRoute.register(app);
 *
 * // Attach OpenAPI metadata and collect for the document:
 * myRoute.withOpenApi({
 *   operationId: "getThing",
 *   tags: ["Things"],
 *   summary: "Get one thing",
 * });
 * ```
 *
 * The handler receives a `RouteContext` with:
 * - `user` — typed per `auth` (`UserAccount`, `UserAccount | null`, or `null`)
 * - `params` — parsed path parameters (or `{}` when no `params` schema)
 * - `query`  — parsed query string (or `{}` when no `query` schema)
 * - `body`   — parsed request body (or `{}` when no `body` schema)
 * - `request` / `reply` — raw Fastify objects for edge cases
 *
 * Any `DomainError` thrown by the handler is mapped to its HTTP answer.
 * Any other error propagates to Fastify's global error handler (→ 500).
 */
export function defineRoute<
  Auth extends AuthMode,
  P extends z.ZodType | undefined = undefined,
  Q extends z.ZodType | undefined = undefined,
  B extends z.ZodType | undefined = undefined,
  R extends z.ZodType = z.ZodType,
>(definition: RouteDefinition<Auth, P, Q, B, R>) {
  function register(app: FastifyInstance): void {
    const method = definition.method.toLowerCase() as "get" | "post" | "put" | "delete";

    app[method](definition.path, async (request: FastifyRequest, reply: FastifyReply) => {
      // ── 1. Auth ──────────────────────────────────────────────────────────
      let user: UserAccount | null = null;

      if (definition.auth === "required") {
        const resolved = requireUser(request, reply);
        if (!resolved) return reply; // 401 already sent
        user = resolved;
      } else if (definition.auth === "optional") {
        user = request.currentUser;
      }
      // auth === "none": user stays null

      // ── 2. Params ────────────────────────────────────────────────────────
      let params: unknown = {};
      if (definition.params) {
        const result = definition.params.safeParse(request.params);
        if (!result.success) {
          return sendError(reply, 400, "invalid_params", "path parameters are invalid");
        }
        params = result.data;
      }

      // ── 3. Query ─────────────────────────────────────────────────────────
      let query: unknown = {};
      if (definition.query) {
        const result = definition.query.safeParse(request.query);
        if (!result.success) {
          return sendError(reply, 400, "invalid_query", "query parameters are invalid", result.error.issues);
        }
        query = result.data;
      }

      // ── 4. Body ──────────────────────────────────────────────────────────
      let body: unknown = {};
      if (definition.body) {
        const result = definition.body.safeParse(request.body);
        if (!result.success) {
          return sendError(reply, 400, "invalid_body", "request body is invalid", result.error.issues);
        }
        body = result.data;
      }

      // ── 5. Handler + DomainError mapping ─────────────────────────────────
      try {
        const result = await definition.handler({
          user: user as RouteContext<Auth>["user"],
          params: params as RouteContext<Auth, P extends z.ZodType ? z.output<P> : undefined>["params"],
          query: query as RouteContext<Auth, undefined, Q extends z.ZodType ? z.output<Q> : undefined>["query"],
          body: body as RouteContext<Auth, undefined, undefined, B extends z.ZodType ? z.output<B> : undefined>["body"],
          request,
          reply,
        });

        // If the handler already sent a reply (e.g. set a status code), don't
        // double-send. Fastify marks the reply as sent in that case.
        if (reply.sent) return reply;
        return result;
      } catch (error) {
        return handleDomainError(reply, error);
      }
    });
  }

  function withOpenApi(meta: RouteOpenApiMeta): typeof routeObject {
    buildOpenApiOperation(definition, meta);
    return routeObject;
  }

  const routeObject = { register, withOpenApi };
  return routeObject;
}
