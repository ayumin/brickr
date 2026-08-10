import type { ProviderId } from "../llm/provider.js";
import type { Db } from "../persistence/prisma.js";
import type { ModelProfile } from "./model-profile.js";

export class ModelProfileRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<ModelProfile | null> {
    const row = await this.db.modelProfile.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id,
      providerId: row.providerId as ProviderId,
      model: row.model,
    };
  }

  async findAll(): Promise<ModelProfile[]> {
    const rows = await this.db.modelProfile.findMany({ orderBy: { id: "asc" } });
    return rows.map((row) => ({
      id: row.id,
      providerId: row.providerId as ProviderId,
      model: row.model,
    }));
  }
}
