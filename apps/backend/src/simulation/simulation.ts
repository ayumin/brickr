import type { SimulationStatus } from "@brickr/shared";

export type Simulation = {
  id: string;
  title: string | null;
  status: SimulationStatus;
  createdAt: Date;
  /** Public to everyone (CLAUDE.md §66.6). Absent for simulations created before login existed. */
  createdByUserId?: string;
};

export type SimulationSummary = Simulation & {
  postCount: number;
};

/** The two post shapes a character can produce. Plain `post` is a standalone comment. */
export const RESPONSE_ACTIONS = ["reply", "quote", "post"] as const;

export type ResponseAction = (typeof RESPONSE_ACTIONS)[number];
