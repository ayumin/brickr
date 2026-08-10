import type { ModelProfileDto } from "@enjo/shared";
import type { ModelProfileRepository } from "./model-profile-repository.js";

export class ModelProfileService {
  constructor(private readonly profiles: ModelProfileRepository) {}

  async listDtos(): Promise<ModelProfileDto[]> {
    const profiles = await this.profiles.findAll();
    return profiles.map((profile) => ({
      id: profile.id,
      providerId: profile.providerId,
      model: profile.model,
    }));
  }
}
