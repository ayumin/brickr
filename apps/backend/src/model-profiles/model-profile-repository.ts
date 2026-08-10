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
    return rows.map((row: { id: string; providerId: string; model: string }) => ({
      id: row.id,
      providerId: row.providerId as ProviderId,
      model: row.model,
    }));
  }

  /** Persist newly discovered provider/model pairs without duplicating seeds. */
  async ensureAll(profiles: readonly ModelProfile[]): Promise<void> {
    if (profiles.length === 0) return;
    const existing = await this.findAll();
    const pairs = new Set(
      existing.map((profile) => `${profile.providerId}\u0000${profile.model}`),
    );
    const missing = profiles.filter((profile) => {
      const pair = `${profile.providerId}\u0000${profile.model}`;
      if (pairs.has(pair)) return false;
      pairs.add(pair);
      return true;
    });

    await Promise.all(
      missing.map((profile) =>
        this.db.modelProfile.upsert({
          where: { id: profile.id },
          create: profile,
          update: {
            providerId: profile.providerId,
            model: profile.model,
          },
        }),
      ),
    );
  }

  async updateModel(id: string, model: string): Promise<void> {
    await this.db.modelProfile.update({ where: { id }, data: { model } });
  }
}
