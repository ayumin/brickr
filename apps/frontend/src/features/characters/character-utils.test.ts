import { describe, expect, it } from "vitest";
import { PROFILE_PREVIEW_LENGTH, truncateProfile } from "./character-utils";

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
    const profile = `${"あ".repeat(29)}🔥`;
    expect(truncateProfile(profile)).toBe(profile);
  });
});
