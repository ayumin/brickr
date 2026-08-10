import { describe, expect, it, vi } from "vitest";
import type { ProviderModelCatalogResult } from "../llm/provider-registry.js";
import type { ModelProfile } from "./model-profile.js";
import type { ModelProfileRepository } from "./model-profile-repository.js";
import {
  catalogModelProfileId,
  ModelProfileService,
} from "./model-profile-service.js";

const SEEDED: ModelProfile = {
  id: "openai-default",
  providerId: "openai",
  model: "gpt-default",
};

describe("ModelProfileService", () => {
  it("persists provider models and returns provider/model sorted options", async () => {
    const profiles = [SEEDED];
    const repository = fakeRepository(profiles);
    const providers = {
      listAvailableModels: vi.fn(() =>
        Promise.resolve<ProviderModelCatalogResult>({
          catalogs: [
            {
              providerId: "anthropic",
              models: [{ id: "claude-test", displayName: "Claude Test" }],
            },
            {
              providerId: "openai",
              models: [{ id: "gpt-default", displayName: "GPT Default" }],
            },
          ],
          failures: [],
        }),
      ),
    };
    const warn = vi.fn();
    const service = new ModelProfileService(repository, providers, { warn }, 1_000);

    await expect(service.listDtos()).resolves.toEqual([
      {
        id: catalogModelProfileId("anthropic", "claude-test"),
        providerId: "anthropic",
        model: "claude-test",
      },
      { id: "openai-default", providerId: "openai", model: "gpt-default" },
    ]);
    expect(providers.listAvailableModels).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();

    // Catalog calls are cached, while the persisted profiles remain readable.
    await service.listDtos();
    expect(providers.listAvailableModels).toHaveBeenCalledTimes(1);
  });

  it("keeps stored profiles and logs a provider-specific catalog failure", async () => {
    const repository = fakeRepository([SEEDED]);
    const providers = {
      listAvailableModels: () =>
        Promise.resolve<ProviderModelCatalogResult>({
          catalogs: [],
          failures: [{ providerId: "openai", reason: "unauthorized" }],
        }),
    };
    const warn = vi.fn();
    const service = new ModelProfileService(repository, providers, { warn }, 1_000);

    await expect(service.listDtos()).resolves.toEqual([
      { id: "openai-default", providerId: "openai", model: "gpt-default" },
    ]);
    expect(warn).toHaveBeenCalledWith(
      { providerId: "openai", reason: "unauthorized" },
      "failed to refresh provider model catalog; keeping stored profiles",
    );
  });

  it("reads stored profiles without contacting providers", async () => {
    const repository = fakeRepository([SEEDED]);
    const providers = { listAvailableModels: vi.fn() };
    const service = new ModelProfileService(
      repository,
      providers,
      { warn: vi.fn() },
      1_000,
    );

    await expect(service.listStoredDtos()).resolves.toEqual([
      { id: "openai-default", providerId: "openai", model: "gpt-default" },
    ]);
    expect(providers.listAvailableModels).not.toHaveBeenCalled();
  });
});

function fakeRepository(initial: ModelProfile[]): ModelProfileRepository {
  const profiles = initial.map((profile) => ({ ...profile }));
  return {
    findAll: () => Promise.resolve(profiles.map((profile) => ({ ...profile }))),
    ensureAll: (incoming: readonly ModelProfile[]) => {
      for (const profile of incoming) {
        if (
          !profiles.some(
            (existing) =>
              existing.providerId === profile.providerId &&
              existing.model === profile.model,
          )
        ) {
          profiles.push({ ...profile });
        }
      }
      return Promise.resolve();
    },
  } as unknown as ModelProfileRepository;
}
