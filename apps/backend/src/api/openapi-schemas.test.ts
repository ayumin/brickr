import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as schemas from "./schemas.js";
import { propertySchema, requestSchema } from "./openapi-schemas.js";

describe("requestSchema", () => {
  it("keeps a pattern lost by transform().pipe() once annotated with .meta()", () => {
    const schema = requestSchema(schemas.handleParams);
    expect((schema.properties?.handle as { pattern?: string }).pattern).toBe("^[a-z0-9_]{3,32}$");
  });

  it("strips the Number.MAX_SAFE_INTEGER noise maximum from an unbounded coerced integer", () => {
    const schema = requestSchema(schemas.userManagementQuerySchema);
    const page = schema.properties?.page as { maximum?: number };
    expect(page.maximum).toBeUndefined();
  });

  it("never emits additionalProperties: false, since these schemas strip rather than reject unknown keys", () => {
    const schema = requestSchema(schemas.saveCharacterSchema);
    expect(schema).not.toHaveProperty("additionalProperties");
  });

  it("carries the content-or-image anyOf rule through from .meta()", () => {
    const schema = requestSchema(schemas.createPostSchema);
    expect(schema.anyOf).toEqual([
      { required: ["content"], properties: { content: { minLength: 1 } } },
      { required: ["imageUrl"] },
    ]);
  });

  /**
   * Every exported Zod schema must convert without throwing. This is what
   * keeps a future schema — one using a Zod feature this converter cannot
   * represent — from crashing server startup: `unrepresentable: "any"`
   * degrades that one field to `{}` instead of throwing.
   */
  it("converts every exported schema without throwing", () => {
    for (const [name, schema] of Object.entries(schemas)) {
      if (!(schema instanceof z.ZodType)) continue;
      expect(() => requestSchema(schema), `schemas.${name}`).not.toThrow();
      const result = requestSchema(schema);
      expect(result, `schemas.${name}`).toBeTypeOf("object");
    }
  });
});

describe("propertySchema", () => {
  it("returns the schema for one property of an object schema", () => {
    const schema = propertySchema(schemas.idParams, "id");
    expect(schema).toEqual({ type: "string", minLength: 1, maxLength: 64 });
  });

  it("throws for a property the schema does not have", () => {
    expect(() => propertySchema(schemas.idParams, "missing")).toThrow();
  });
});
