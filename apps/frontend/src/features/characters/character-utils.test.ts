import { describe, expect, it } from "vitest";
import {
  PROFILE_PREVIEW_LENGTH,
  compareOptionalNumbers,
  parseBulkCharacterCount,
  truncateProfile,
  truncateText,
} from "./character-utils";

describe("truncateProfile", () => {
  it("keeps a profile of exactly 30 characters unchanged", () => {
    const profile = "あ".repeat(PROFILE_PREVIEW_LENGTH);
    expect(truncateProfile(profile)).toBe(profile);
  });

  it("shortens a long profile to 30 characters including the ellipsis", () => {
    const preview = truncateProfile("あ".repeat(50));
    expect(Array.from(preview)).toHaveLength(PROFILE_PREVIEW_LENGTH);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("counts an emoji as one Unicode character", () => {
    const profile = `${"あ".repeat(29)}火`;
    expect(truncateProfile(profile)).toBe(profile);
  });
});

describe("truncateText", () => {
  it("limits table text to 100 characters including the ellipsis", () => {
    const preview = truncateText("長".repeat(120), 100);
    expect(Array.from(preview)).toHaveLength(100);
    expect(preview.endsWith("…")).toBe(true);
  });
});

describe("compareOptionalNumbers", () => {
  it("sorts values in either direction", () => {
    expect(compareOptionalNumbers(0.2, 0.8, "asc")).toBeLessThan(0);
    expect(compareOptionalNumbers(0.2, 0.8, "desc")).toBeGreaterThan(0);
  });

  it("keeps an unloaded value last in both directions", () => {
    expect(compareOptionalNumbers(undefined, 0.5, "asc")).toBeGreaterThan(0);
    expect(compareOptionalNumbers(undefined, 0.5, "desc")).toBeGreaterThan(0);
  });
});

describe("parseBulkCharacterCount", () => {
  it("accepts integer text from 1 through 100", () => {
    expect(parseBulkCharacterCount("1")).toBe(1);
    expect(parseBulkCharacterCount("10")).toBe(10);
    expect(parseBulkCharacterCount("100")).toBe(100);
  });

  it.each(["", "0", "01", "101", "1.5", "-1", "+2", "abc"])(
    "rejects invalid input %j",
    (input) => {
      expect(parseBulkCharacterCount(input)).toBeNull();
    },
  );
});
