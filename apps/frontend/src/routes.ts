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

export function roomListPath(): string {
  return "/rooms";
}

export function roomPath(roomId: string): string {
  return `/rooms/${encodeURIComponent(roomId)}`;
}

export function roomAnalysisPath(roomId: string): string {
  return `/rooms/${encodeURIComponent(roomId)}/analysis`;
}

export function castPath(): string {
  return "/cast";
}

export const SETTINGS_SECTIONS = [
  "profile",
  "appearance",
  "usage",
  "runtime",
  "users",
  "invites",
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export function settingsPath(section: SettingsSection): string {
  return `/settings/${section}`;
}

export function isSettingsSection(value: string): value is SettingsSection {
  return (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

export type RouteMatch =
  | { kind: "home" }
  | { kind: "characters" }
  | { kind: "simulations" }
  | { kind: "simulation-analysis"; simulationId: string }
  | { kind: "post"; postId: string }
  | { kind: "users-management" }
  | { kind: "handle"; handle: string }
  | { kind: "rooms" }
  | { kind: "room"; roomId: string }
  | { kind: "room-analysis"; roomId: string }
  | { kind: "cast" }
  | { kind: "settings"; section: SettingsSection }
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
  if (matchPath({ path: roomListPath(), end: true }, pathname)) {
    return { kind: "rooms" };
  }
  if (matchPath({ path: castPath(), end: true }, pathname)) {
    return { kind: "cast" };
  }

  const analysis = matchPath({ path: "/simulations/:id/analysis", end: true }, pathname);
  if (analysis?.params.id) {
    return { kind: "simulation-analysis", simulationId: analysis.params.id };
  }

  const roomAnalysis = matchPath({ path: "/rooms/:id/analysis", end: true }, pathname);
  if (roomAnalysis?.params.id) {
    return { kind: "room-analysis", roomId: roomAnalysis.params.id };
  }

  const room = matchPath({ path: "/rooms/:id", end: true }, pathname);
  if (room?.params.id) {
    return { kind: "room", roomId: room.params.id };
  }

  const post = matchPath({ path: "/posts/:id", end: true }, pathname);
  if (post?.params.id) {
    return { kind: "post", postId: post.params.id };
  }

  const settings = matchPath({ path: "/settings/:section", end: true }, pathname);
  if (settings?.params.section && isSettingsSection(settings.params.section)) {
    return { kind: "settings", section: settings.params.section };
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
