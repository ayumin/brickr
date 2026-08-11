import type { SimulationSummaryDto } from "@brickr/shared";

/** Mirrors the backend's `isSimulationOwnerOrAdmin` (CLAUDE.md §66.3, §66.6). */
export function canManageSimulation(
  simulation: Pick<SimulationSummaryDto, "createdByUserId">,
  currentUserId: string,
  isAdmin: boolean,
): boolean {
  return isAdmin || simulation.createdByUserId === currentUserId;
}

/**
 * Ownership is public (§66.6), but the frontend has no way to resolve an
 * arbitrary other user's id to a handle/displayName - only the viewer's own
 * identity is known. "他のユーザー" is deliberately generic rather than a
 * fabricated name.
 */
export function simulationCreatorLabel(
  simulation: Pick<SimulationSummaryDto, "createdByUserId">,
  currentUserId: string,
): string {
  if (simulation.createdByUserId === undefined || simulation.createdByUserId === null) return "—";
  return simulation.createdByUserId === currentUserId ? "あなた" : "他のユーザー";
}
