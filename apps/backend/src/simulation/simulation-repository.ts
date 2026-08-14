import type { SimulationScope, SimulationStatus } from "@brickr/shared";
import type { Db } from "../persistence/prisma.js";
import { optionalField } from "../persistence/repository-mapping.js";
import type { Simulation, SimulationSummary } from "./simulation.js";

type SimulationRow = {
  id: string;
  title: string | null;
  status: string;
  scope: string;
  createdAt: Date;
  lastActivityAt: Date;
  createdByUserId: string | null;
};

/** The database column is an unconstrained string; this is the one place that trusts it. */
export function toSimulationStatus(value: string): SimulationStatus {
  return value as SimulationStatus;
}

/** The database column is an unconstrained string; this is the one place that trusts it. */
export function toSimulationScope(value: string): SimulationScope {
  return value as SimulationScope;
}

function toSimulation(row: SimulationRow): Simulation {
  return {
    id: row.id,
    title: row.title,
    status: toSimulationStatus(row.status),
    scope: toSimulationScope(row.scope),
    createdAt: row.createdAt,
    lastActivityAt: row.lastActivityAt,
    ...optionalField("createdByUserId", row.createdByUserId),
  };
}

export class SimulationRepository {
  constructor(private readonly db: Db) {}

  /**
   * A room, always. The global row is seeded, never created here (§8.2).
   *
   * `lastActivityAt` starts at the creation time so an empty room still sorts
   * sensibly in an activity-ordered list.
   */
  async create(title: string | null, createdByUserId: string): Promise<Simulation> {
    const createdAt = new Date();
    const row = await this.db.simulation.create({
      data: {
        title,
        status: "active",
        scope: "room",
        createdByUserId,
        createdAt,
        lastActivityAt: createdAt,
      },
    });
    return toSimulation(row);
  }

  /** Rooms only: the global simulation is the feed, not an entry in the room list (§8.2). */
  async findAll(): Promise<SimulationSummary[]> {
    const rows = await this.db.simulation.findMany({
      where: { scope: "room" },
      include: { _count: { select: { posts: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return rows.map((row) => ({
      ...toSimulation(row),
      postCount: row._count.posts,
    }));
  }

  async findById(id: string): Promise<Simulation | null> {
    const row = await this.db.simulation.findUnique({ where: { id } });
    return row ? toSimulation(row) : null;
  }

  async updateTitle(id: string, title: string): Promise<Simulation> {
    const row = await this.db.simulation.update({ where: { id }, data: { title } });
    return toSimulation(row);
  }

  async updateStatus(id: string, status: SimulationStatus): Promise<Simulation> {
    const row = await this.db.simulation.update({
      where: { id },
      data: { status },
    });
    return toSimulation(row);
  }
}
