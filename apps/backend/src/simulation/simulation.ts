import { GLOBAL_SIMULATION_ID, type SimulationScope, type SimulationStatus } from "@brickr/shared";
import type { UserAccount } from "../auth/user-account.js";

/**
 * The signed-in caller, reduced to what an ownership check needs (CLAUDE.md §66.6).
 *
 * Defined with the domain model rather than with the service, because the
 * repository needs it too: which rooms exist *for this caller* is part of the
 * query (§10.3), and a repository must not import from a service.
 */
export type SimulationActor = Pick<UserAccount, "id" | "isAdmin">;

export type Simulation = {
  id: string;
  title: string | null;
  status: SimulationStatus;
  /** Internal only (§8.1). `"global"` marks the reserved row behind the feed. */
  scope: SimulationScope;
  createdAt: Date;
  /** Newest activity anywhere in the simulation, used to order rooms (§8.1). */
  lastActivityAt: Date;
  /** Public to everyone (CLAUDE.md §66.6). Absent for simulations created before login existed. */
  createdByUserId?: string;
};

/**
 * Checked by id as well as by scope: the id is fixed and seeded (§8.2), so a row
 * whose scope was somehow changed is still protected.
 */
export function isGlobalSimulation(simulation: Pick<Simulation, "id" | "scope">): boolean {
  return simulation.scope === "global" || simulation.id === GLOBAL_SIMULATION_ID;
}

/** Public identity of a room's creator, for the room list (§10.3). */
export type SimulationCreator = {
  id: string;
  handle: string;
  displayName: string;
};

export type SimulationSummary = Simulation & {
  postCount: number;
  /** `null` when the room has no owner — a room created before login existed. */
  creator: SimulationCreator | null;
};

/** The two post shapes a character can produce. Plain `post` is a standalone comment. */
export const RESPONSE_ACTIONS = ["reply", "quote", "post"] as const;

export type ResponseAction = (typeof RESPONSE_ACTIONS)[number];
