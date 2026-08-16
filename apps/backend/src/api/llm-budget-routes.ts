import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../auth/auth-context.js";
import type { AppServices } from "../services.js";
import { parseOr400, withDomainErrors } from "./route-helpers.js";
import { llmBudgetProviderParams, setBudgetLimitSchema } from "./schemas.js";

/**
 * Admin-only LLM budget and circuit-breaker endpoints (issue #162).
 *
 * GET  /api/llm-budget                    — list all provider budgets
 * PUT  /api/llm-budget/:provider          — set the token limit for a provider
 * POST /api/llm-budget/:provider/reset    — reset the circuit breaker for a provider
 */
export function registerLLMBudgetRoutes(
  app: FastifyInstance,
  services: AppServices,
): void {
  /** Returns the current budget state for all providers. Admin-only. */
  app.get("/api/llm-budget", async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    return services.llmBudget.getAll();
  });

  /** Sets the token limit for a specific provider. Admin-only. */
  app.put("/api/llm-budget/:provider", async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;

    const params = parseOr400(
      llmBudgetProviderParams,
      request.params,
      reply,
      "invalid_params",
      "provider is invalid",
    );
    if (!params) return reply;

    const body = parseOr400(
      setBudgetLimitSchema,
      request.body,
      reply,
      "invalid_body",
      "budget limit is invalid",
    );
    if (!body) return reply;

    return withDomainErrors(reply, async () => {
      const provider = await services.llmBudget.setLimit({
        provider: params.provider,
        tokenLimit: body.tokenLimit,
      });
      return { provider };
    });
  });

  /**
   * Resets the circuit breaker for a provider: clears the stopped flag and
   * zeroes the global token aggregate. Admin-only.
   */
  app.post("/api/llm-budget/:provider/reset", async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;

    const params = parseOr400(
      llmBudgetProviderParams,
      request.params,
      reply,
      "invalid_params",
      "provider is invalid",
    );
    if (!params) return reply;

    return withDomainErrors(reply, async () => {
      const provider = await services.llmBudget.reset(params.provider);
      return { provider };
    });
  });
}
