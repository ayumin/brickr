/**
 * Where a `TimelineView` (types/index.ts) lives as a URL (CLAUDE.md §66.2).
 *
 * `SimulationView` stays a single persistent component across navigations —
 * remounting it on every view change would drop the SSE connection and reset
 * unrelated UI state (sidebar, composer, …) for no reason. So routes are not
 * a `<Route>` tree that mounts a different element per view; they are matched
 * against the current location by hand, and `useNavigate` drives history.
 */
import { matchPath } from "react-router-dom";
import { HANDLE_PATTERN, isReservedHandle } from "@brickr/shared";

const HANDLE_REGEXP = new RegExp(HANDLE_PATTERN);

export function characterListPath(): string {
  return "/characters";
}

export function simulationListPath(): string {
  return "/simulations";
}

export function simulationAnalysisPath(simulationId: string): string {
  return `/simulations/${encodeURIComponent(simulationId)}/analysis`;
}

export function postPath(postId: string): string {
  return `/posts/${encodeURIComponent(postId)}`;
}

export function handlePath(handle: string): string {
  return `/${encodeURIComponent(handle)}`;
}

/**
 * Under the already-reserved `admin` segment (packages/shared/src/handle.ts)
 * rather than a new top-level `/users`, so no new word has to be added to
 * `RESERVED_HANDLES` just to make room for this screen.
 */
export function usersManagementPath(): string {
  return "/admin/users";
}

export type RouteMatch =
  | { kind: "home" }
  | { kind: "characters" }
  | { kind: "simulations" }
  | { kind: "simulation-analysis"; simulationId: string }
  | { kind: "post"; postId: string }
  | { kind: "users-management" }
  | { kind: "handle"; handle: string }
  | { kind: "not-found" };

/**
 * Static paths are matched before the `/:handle` catch-all, the same
 * precedence `RESERVED_HANDLES` (packages/shared/src/handle.ts) documents.
 * A malformed or reserved handle segment is reported as `not-found` rather
 * than passed through, so callers never have to re-validate it.
 */
export function matchRoute(pathname: string): RouteMatch {
  if (matchPath({ path: "/", end: true }, pathname)) {
    return { kind: "home" };
  }
  if (matchPath({ path: characterListPath(), end: true }, pathname)) {
    return { kind: "characters" };
  }
  if (matchPath({ path: simulationListPath(), end: true }, pathname)) {
    return { kind: "simulations" };
  }
  if (matchPath({ path: usersManagementPath(), end: true }, pathname)) {
    return { kind: "users-management" };
  }

  const analysis = matchPath({ path: "/simulations/:id/analysis", end: true }, pathname);
  if (analysis?.params.id) {
    return { kind: "simulation-analysis", simulationId: analysis.params.id };
  }

  const post = matchPath({ path: "/posts/:id", end: true }, pathname);
  if (post?.params.id) {
    return { kind: "post", postId: post.params.id };
  }

  const handle = matchPath({ path: "/:handle", end: true }, pathname);
  const raw = handle?.params.handle;
  // Same normalization as the backend's handleParams schema: a leading `@`
  // and mixed case are both what a user actually copies out of a timeline.
  const candidate = raw?.replace(/^@/u, "").toLowerCase();
  if (candidate && HANDLE_REGEXP.test(candidate) && !isReservedHandle(candidate)) {
    return { kind: "handle", handle: candidate };
  }

  return { kind: "not-found" };
}
