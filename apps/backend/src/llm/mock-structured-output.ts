/**
 * Synthesizes a mock value for the JSON Schema subset structured-output callers
 * emit (see `characters/character-generator.ts` and
 * `rooms/room-analysis-service.ts`).
 *
 * The mock provider has no knowledge of what any particular schema means — it
 * only walks its shape — so a new structured-output caller works against the
 * mock automatically, with no change to this file or to `mock-provider.ts`.
 */

const MAX_DEPTH = 8;

export function synthesizeFromJsonSchema(schema: Record<string, unknown>, seed: number): unknown {
  return synthesizeAt(schema, "", seed, 0);
}

function synthesizeAt(
  schema: Record<string, unknown>,
  path: string,
  seed: number,
  depth: number,
): unknown {
  if (depth > MAX_DEPTH) return null;

  switch (schema.type) {
    case "object": {
      const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
      return Object.fromEntries(
        Object.entries(properties).map(([key, propertySchema]) => [
          key,
          synthesizeAt(propertySchema, path ? `${path}.${key}` : key, seed, depth + 1),
        ]),
      );
    }
    case "array": {
      const itemSchema = (schema.items ?? { type: "string" }) as Record<string, unknown>;
      const minItems = typeof schema.minItems === "number" ? schema.minItems : 1;
      const count = Math.max(1, minItems);
      return Array.from({ length: count }, (_unused, index) =>
        synthesizeAt(itemSchema, `${path}[${String(index)}]`, seed, depth + 1),
      );
    }
    case "integer":
    case "number":
      return typeof schema.minimum === "number" ? schema.minimum : 0;
    case "boolean":
      return false;
    case "string": {
      const enumValues = schema.enum;
      if (Array.isArray(enumValues) && enumValues.length > 0) return enumValues[0];
      return mockString(path, seed);
    }
    default:
      return null;
  }
}

/** Short, never-empty Japanese placeholder text, varied by path so sibling fields differ. */
const FRAGMENTS = [
  "現場の状況を踏まえて考えたい話題です。",
  "まずは小さく試してみるのが良さそうです。",
  "前提を一度整理しておきたいところです。",
  "運用まで見据えて検討する必要があります。",
  "率直に言うと、もう少し様子を見たいです。",
  "全体のバランスを見ながら判断しています。",
  "自分の経験から言うと、慎重に進めたいです。",
  "別の選択肢も含めて比較してみたいですね。",
] as const;

function mockString(path: string, seed: number): string {
  const value = hash(`${String(seed)}|${path}`);
  const fragment = FRAGMENTS[value % FRAGMENTS.length] ?? FRAGMENTS[0];
  // The numeric tag carries most of the entropy: the fragment alone repeats
  // across enough (seed, path) pairs that unrelated fields could collide.
  return `${fragment}(#${String(value % 10_000)})`;
}

/** Tiny deterministic string hash (FNV-1a style), kept non-negative. */
function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return Math.abs(result | 0);
}
