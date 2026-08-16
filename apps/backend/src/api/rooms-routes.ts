/**
 * Sample routes implemented with `defineRoute` (issue #150).
 *
 * These demonstrate the unified auth / Zod validation / AppError conversion /
 * OpenAPI pattern. The `defineRoute` call is the single source of truth for
 * each route: the same schemas that drive the handler also generate the
 * OpenAPI operation object, so a constraint cannot be tightened in the
 * validator and left stale in the documentation.
 *
 * Completion criteria (§150):
 *   - auth: "required" → 401 when signed out
 *   - Zod validation → 400 with structured error details
 *   - DomainError → mapped to its HTTP answer
 *   - OpenAPI operation derived from the same schemas
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppServices } from "../services.js";
import { buildOpenApiOperation, defineRoute } from "./define-route.js";

export const roomIdParams = z.object({
  id: z.string().trim().min(1).max(64).describe("Room ID"),
});

const roomSummarySchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  status: z.enum(["active", "archived"]),
  createdAt: z.string(),
  createdByUserId: z.string().optional(),
  postCount: z.number().int().min(0),
  lastActivityAt: z.string(),
  creator: z
    .object({ id: z.string(), handle: z.string(), displayName: z.string() })
    .nullable(),
  canManage: z.boolean(),
});

// The service returns { simulation: SimulationSummaryDto }; the response schema
// mirrors that shape for OpenAPI documentation.
export const roomSummaryResponseSchema = z.object({
  simulation: roomSummarySchema,
});

/**
 * OpenAPI metadata for `GET /api/rooms/:id`.
 *
 * Kept as a named export so tests can assert the operation is correctly derived
 * from the schemas without needing a running Fastify instance.
 */
export const getRoomOpenApiMeta = {
  operationId: "getRoomSummary",
  tags: ["Simulations"] as string[],
  summary: "Get one room's summary (defineRoute demo)",
  description:
    "Demonstrates the `defineRoute` pattern (issue #150): auth, Zod validation, " +
    "DomainError mapping, and OpenAPI output all derived from the same definition. " +
    "Mirrors `GET /api/simulations/:id` but implemented via `defineRoute`.",
  successDescription: "The room's summary",
  extraResponses: {
    "404": { $ref: "#/components/responses/NotFound" },
  },
};

/**
 * Register the OpenAPI operation at module load time.
 *
 * This runs once when the module is first imported, so the operation is
 * available in `registeredRoutes` before any Fastify instance is created.
 * The handler is bound separately in `registerRoomsRoutes`.
 */
buildOpenApiOperation(
  {
    method: "GET",
    path: "/api/rooms/:id",
    auth: "required",
    params: roomIdParams,
    response: roomSummaryResponseSchema,
  },
  getRoomOpenApiMeta,
);

/**
 * Registers `GET /api/rooms/:id` on the given Fastify instance.
 *
 * This is a sample route that mirrors `GET /api/simulations/:id` but is
 * implemented entirely through `defineRoute`, demonstrating:
 *
 *   1. `auth: "required"` — 401 when signed out, `ctx.user` is `UserAccount`
 *   2. `params` schema — 400 for a missing or malformed id
 *   3. `DomainError` from the service — mapped to its HTTP answer
 *   4. `response` schema — drives the OpenAPI success response
 */
export function registerRoomsRoutes(app: FastifyInstance, services: AppServices): void {
  defineRoute({
    method: "GET",
    path: "/api/rooms/:id",
    auth: "required",
    params: roomIdParams,
    response: roomSummaryResponseSchema,
    handler: async ({ user, params }) => {
      // Delegate to the simulation service, which enforces ownership rules and
      // throws a DomainError (→ 404) for a stopped room the caller may not see.
      // The DomainError is caught by defineRoute and mapped to its HTTP answer.
      // services.simulations.get returns { simulation: SimulationSummaryDto }.
      return services.simulations.get(params.id, user);
    },
  }).register(app);
}
