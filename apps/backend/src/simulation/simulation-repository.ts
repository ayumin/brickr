import type { SimulationStatus } from "@brickr/shared";
import type { Db } from "../persistence/prisma.js";
import type { Simulation, SimulationSummary } from "./simulation.js";

type SimulationRow = {
  id: string;
  title: string | null;
  status: string;
  createdAt: Date;
};

function toSimulation(row: SimulationRow): Simulation {
  return {
    id: row.id,
    title: row.title,
    status: row.status as SimulationStatus,
    createdAt: row.createdAt,
  };
}

export class SimulationRepository {
  constructor(private readonly db: Db) {}

  async create(title: string | null): Promise<Simulation> {
    const row = await this.db.simulation.create({
      data: { title, status: "active" },
    });
    return toSimulation(row);
  }

  async findAll(): Promise<SimulationSummary[]> {
    const rows = await this.db.simulation.findMany({
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
