import { describe, expect, it } from "vitest";
import { InvalidApplicationSettingError, RuntimeSettings } from "./runtime-settings.js";

describe("RuntimeSettings", () => {
  it("applies overrides without replacing objects held by running services", () => {
    const runtime = new RuntimeSettings();
    const llmReference = runtime.values.llm;
    const roomReference = runtime.values.room;
    const next = runtime.preview({
      LLM_TIMEOUT_MS: "45000",
      MAX_CONCURRENT_CHARACTERS: "9",
      OPENAI_MODEL: "gpt-test",
    });
    runtime.load(next);

    expect(runtime.values.llm).toBe(llmReference);
    expect(runtime.values.room).toBe(roomReference);
    expect(runtime.values.llm.timeoutMs).toBe(45_000);
    expect(runtime.values.room.maxConcurrentCharacters).toBe(9);
    expect(runtime.values.models.openai).toBe("gpt-test");
    expect(runtime.isOverridden("OPENAI_MODEL")).toBe(true);
  });

  it("restores the environment value when an override is removed", () => {
    const runtime = new RuntimeSettings();
    const environmentModel = runtime.values.models.openai;
    runtime.load(runtime.preview({ OPENAI_MODEL: "gpt-test" }));
    runtime.load(runtime.preview({ OPENAI_MODEL: null }));

    expect(runtime.values.models.openai).toBe(environmentModel);
    expect(runtime.isOverridden("OPENAI_MODEL")).toBe(false);
  });

  it("rejects invalid ranges and responder bounds", () => {
    const runtime = new RuntimeSettings();
    expect(() => runtime.preview({ LLM_MAX_RETRIES: "3" })).toThrow(
      InvalidApplicationSettingError,
    );
    expect(() =>
      runtime.preview({ MIN_RESPONDERS: "10", MAX_RESPONDERS: "2" }),
    ).toThrow(InvalidApplicationSettingError);
  });
});
