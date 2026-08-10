import { createHash } from "node:crypto";
import type { ModelProfileDto } from "@enjo/shared";
import type {
  LLMProviderRegistry,
  ProviderModelCatalog,
} from "../llm/provider-registry.js";
import type { SimulationLogger } from "../simulation/simulation-service.js";
import type { ModelProfile } from "./model-profile.js";
import type { ModelProfileRepository } from "./model-profile-repository.js";

const CATALOG_CACHE_MS = 5 * 60 * 1_000;

export class ModelProfileService {
  private lastRefreshAt = 0;
  private refreshInFlight: Promise<void> | null = null;

  constructor(
    private readonly profiles: ModelProfileRepository,
    private readonly providers: Pick<LLMProviderRegistry, "listAvailableModels">,
    private readonly logger: Pick<SimulationLogger, "warn">,
    private readonly timeoutMs: number | (() => number),
  ) {}

  async listDtos(): Promise<ModelProfileDto[]> {
    await this.refreshCatalog();
    return this.listStoredDtos();
  }

  /** Read the persisted catalog without waiting for provider network requests. */
  async listStoredDtos(): Promise<ModelProfileDto[]> {
    const profiles = await this.profiles.findAll();
    return profiles
      .map((profile) => ({
        id: profile.id,
        providerId: profile.providerId,
        model: profile.model,
      }))
      .sort(
        (a, b) =>
          a.providerId.localeCompare(b.providerId) || a.model.localeCompare(b.model),
      );
  }

  private async refreshCatalog(): Promise<void> {
    if (Date.now() - this.lastRefreshAt < CATALOG_CACHE_MS) return;
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = this.fetchAndPersistCatalog()
      .then(() => {
        this.lastRefreshAt = Date.now();
      })
      .finally(() => {
        this.refreshInFlight = null;
      });
    return this.refreshInFlight;
  }

  private async fetchAndPersistCatalog(): Promise<void> {
    const controller = new AbortController();
    const timeoutMs =
      typeof this.timeoutMs === "function" ? this.timeoutMs() : this.timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await this.providers.listAvailableModels(controller.signal);
      await this.profiles.ensureAll(result.catalogs.flatMap(toModelProfiles));
      for (const failure of result.failures) {
        this.logger.warn(
          { providerId: failure.providerId, reason: failure.reason },
          "failed to refresh provider model catalog; keeping stored profiles",
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

function toModelProfiles(catalog: ProviderModelCatalog): ModelProfile[] {
  return catalog.models.map((model) => ({
    id: catalogModelProfileId(catalog.providerId, model.id),
    providerId: catalog.providerId,
    model: model.id,
  }));
}

/** Stable, request-safe id; provider model names can be long or contain slashes. */
export function catalogModelProfileId(providerId: string, model: string): string {
  const digest = createHash("sha256")
    .update(`${providerId}\u0000${model}`)
    .digest("hex")
    .slice(0, 24);
  return `catalog-${providerId}-${digest}`;
}
