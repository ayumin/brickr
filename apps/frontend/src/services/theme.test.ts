import { describe, expect, it } from "vitest";
import { THEME_OPTIONS } from "./theme";

describe("THEME_OPTIONS", () => {
  it("defines the eight selectable brand themes with unique ids", () => {
    expect(THEME_OPTIONS).toHaveLength(8);
    expect(new Set(THEME_OPTIONS.map((option) => option.id)).size).toBe(8);
  });

  it("provides three preview colors for every theme", () => {
    for (const option of THEME_OPTIONS) {
      expect(option.swatches).toHaveLength(3);
      expect(option.swatches.every((color) => /^#[0-9a-f]{6}$/iu.test(color))).toBe(true);
    }
  });
});
