import { matchPath } from "react-router-dom";
import { castPath, roomAnalysisPath, roomListPath } from "../routes";

/**
 * Where an old URL now lives, or `null` when `pathname` isn't a legacy one
 * (§6.2). Kept alongside the new path builders in `routes.ts` are, since a
 * renamed builder here would otherwise go unnoticed by whichever of the two
 * still points at the old name.
 */
export function legacyRedirectTarget(pathname: string): string | null {
  if (matchPath({ path: "/characters", end: true }, pathname)) {
    return castPath();
  }
  if (matchPath({ path: "/simulations", end: true }, pathname)) {
    return roomListPath();
  }
  const analysis = matchPath({ path: "/simulations/:id/analysis", end: true }, pathname);
  if (analysis?.params.id) {
    return roomAnalysisPath(analysis.params.id);
  }
  return null;
}
