import type { OpenAPIV3 } from "openapi-types";
import { z } from "zod";

/**
 * Derives an OpenAPI Schema Object from the Zod schema that actually validates
 * the request (CLAUDE.md §55), so a constraint cannot be tightened in the
 * validator and left stale in the documentation.
 *
 * `io: "input"` because request bodies are read pre-validation, and because
 * `io: "output"` would emit `additionalProperties: false` for every
 * `z.object()` here — a documentation lie, since these schemas strip unknown
 * keys rather than reject them. `unrepresentable: "any"` is a safety net: this
 * document is computed at import time, so a schema feature the converter
 * cannot represent must degrade one field to `{}` rather than crash server
 * startup.
 */
export function requestSchema(schema: z.ZodType): OpenAPIV3.SchemaObject {
  const converted = z.toJSONSchema(schema, {
    target: "openapi-3.0",
    io: "input",
    unrepresentable: "any",
  }) as OpenAPIV3.SchemaObject;

  stripMaxSafeIntegerNoise(converted);
  return converted;
}

/**
 * `z.coerce.number().int().min(N)` has no upper bound in Zod, but the
 * converter fills one in from `Number.MAX_SAFE_INTEGER`. That is noise, not a
 * real constraint the API enforces, so it is stripped wherever it appears —
 * not just at the schema's own root, but in nested `properties` and `items`.
 */
function stripMaxSafeIntegerNoise(schema: unknown): void {
  if (typeof schema !== "object" || schema === null) return;
  const node = schema as { maximum?: number; properties?: Record<string, unknown>; items?: unknown };
  if (node.maximum === Number.MAX_SAFE_INTEGER) delete node.maximum;
  if (node.properties) {
    for (const value of Object.values(node.properties)) stripMaxSafeIntegerNoise(value);
  }
  if (node.items) stripMaxSafeIntegerNoise(node.items);
}

/** The Schema Object for one property of a derived object schema. */
export function propertySchema(schema: z.ZodObject, property: string): OpenAPIV3.SchemaObject {
  const object = requestSchema(schema) as { properties?: Record<string, OpenAPIV3.SchemaObject> };
  const found = object.properties?.[property];
  if (!found) throw new Error(`schema has no property "${property}"`);
  return found;
}
