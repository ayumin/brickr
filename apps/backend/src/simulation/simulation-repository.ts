import type { SimulationStatus } from "@enjo/shared";
import type { Db } from "../persistence/prisma.js";
import type { Simulation } from "./simulation.js";

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

  async findById(id: string): Promise<Simulation | null> {
    const row = await this.db.simulation.findUnique({ where: { id } });
    return row ? toSimulation(row) : null;
  }

  async updateStatus(id: string, status: SimulationStatus): Promise<Simulation> {
    const row = await this.db.simulation.update({
      where: { id },
      data: { status },
    });
    return toSimulation(row);
  }
}
