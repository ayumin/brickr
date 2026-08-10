import { describe, expect, it } from "vitest";
import { EDITABLE_APPLICATION_SETTING_NAMES } from "./application-settings.js";

describe("application setting names", () => {
  it("does not contain duplicate editable setting names", () => {
    expect(new Set(EDITABLE_APPLICATION_SETTING_NAMES).size).toBe(
      EDITABLE_APPLICATION_SETTING_NAMES.length,
    );
  });

  it("does not permit API keys or mock mode to be overridden", () => {
    expect(EDITABLE_APPLICATION_SETTING_NAMES).not.toContain("OPENAI_API_KEY");
    expect(EDITABLE_APPLICATION_SETTING_NAMES).not.toContain("ANTHROPIC_API_KEY");
    expect(EDITABLE_APPLICATION_SETTING_NAMES).not.toContain("GEMINI_API_KEY");
    expect(EDITABLE_APPLICATION_SETTING_NAMES).not.toContain("USE_MOCK_LLM");
  });
});
