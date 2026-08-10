import { describe, expect, it } from "vitest";
import type { LLMProviderRegistry } from "../llm/provider-registry.js";
import { LLMUsageTracker } from "../llm/usage-tracker.js";
import type { ModelProfileService } from "../model-profiles/model-profile-service.js";
import type { ModelProfileRepository } from "../model-profiles/model-profile-repository.js";
import { ApplicationSettingsService } from "./application-settings-service.js";
import type { ApplicationSettingRepository } from "./application-setting-repository.js";
import { RuntimeSettings } from "./runtime-settings.js";

describe("ApplicationSettingsService", () => {
  it("returns only allowlisted environment values and masks credentials", async () => {
    const modelProfiles = {
      listStoredDtos: () => Promise.resolve([]),
    } as unknown as ModelProfileService;
    const providers = {
      availableIds: () => ["mock" as const],
    } as Pick<LLMProviderRegistry, "availableIds">;
    const modelProfileRepository = {} as ModelProfileRepository;
    const repository = {} as ApplicationSettingRepository;
    const result = await new ApplicationSettingsService(
      modelProfiles,
      modelProfileRepository,
      providers,
      new LLMUsageTracker(),
      repository,
      new RuntimeSettings(),
    ).get();

    expect(result.environment.some((item) => item.name === "DATABASE_URL")).toBe(false);
    expect(
      result.environment
        .filter((item) => item.secret)
        .every((item) => item.value === "設定済み" || item.value === "未設定"),
    ).toBe(true);
    expect(result.llm.providers.find((item) => item.providerId === "mock")?.available).toBe(true);
    expect(result.environment.find((item) => item.name === "OPENAI_API_KEY")?.editable).toBe(false);
    expect(result.environment.find((item) => item.name === "OPENAI_MODEL")?.editable).toBe(true);
    expect(result.environment.find((item) => item.name === "USE_MOCK_LLM")).toMatchObject({
      editable: false,
      inputType: "toggle",
    });
  });
});
