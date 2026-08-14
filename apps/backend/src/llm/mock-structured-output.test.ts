import { describe, expect, it } from "vitest";
import { synthesizeFromJsonSchema } from "./mock-structured-output.js";

describe("synthesizeFromJsonSchema", () => {
  it("fills every required key of a nested object-of-objects schema", () => {
    const schema = {
      type: "object",
      properties: {
        characters: {
          type: "object",
          properties: {
            character_1: {
              type: "object",
              properties: {
                displayName: { type: "string" },
                interests: { type: "array", minItems: 1, items: { type: "string" } },
              },
              required: ["displayName", "interests"],
            },
            character_2: {
              type: "object",
              properties: { displayName: { type: "string" } },
              required: ["displayName"],
            },
          },
          required: ["character_1", "character_2"],
        },
      },
      required: ["characters"],
    };

    const result = synthesizeFromJsonSchema(schema, 1) as {
      characters: {
        character_1: { displayName: string; interests: string[] };
        character_2: { displayName: string };
      };
    };

    expect(typeof result.characters.character_1.displayName).toBe("string");
    expect(result.characters.character_1.displayName.length).toBeGreaterThan(0);
    expect(typeof result.characters.character_2.displayName).toBe("string");
    expect(result.characters.character_2.displayName.length).toBeGreaterThan(0);
  });

  it("emits a non-empty array honoring minItems", () => {
    const schema = {
      type: "array",
      minItems: 3,
      items: { type: "string" },
    };

    const result = synthesizeFromJsonSchema(schema, 1) as string[];

    expect(result).toHaveLength(3);
    for (const item of result) {
      expect(typeof item).toBe("string");
      expect(item.length).toBeGreaterThan(0);
    }
  });

  it("never emits an empty string", () => {
    const schema = { type: "string" };
    const result = synthesizeFromJsonSchema(schema, 42) as string;
    expect(result.trim().length).toBeGreaterThan(0);
  });

  it("gives sibling properties different values", () => {
    const schema = {
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "string" },
        c: { type: "string" },
        d: { type: "string" },
        e: { type: "string" },
      },
      required: ["a", "b", "c", "d", "e"],
    };

    const result = synthesizeFromJsonSchema(schema, 7) as Record<string, string>;
    const distinctValues = new Set(Object.values(result));
    expect(distinctValues.size).toBeGreaterThan(1);
  });

  it("is deterministic for the same schema and seed", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string" }, count: { type: "integer" } },
      required: ["name", "count"],
    };

    expect(synthesizeFromJsonSchema(schema, 99)).toEqual(synthesizeFromJsonSchema(schema, 99));
  });

  it("honors an enum by returning its first value", () => {
    const schema = { type: "string", enum: ["foo", "bar"] };
    expect(synthesizeFromJsonSchema(schema, 1)).toBe("foo");
  });
});
