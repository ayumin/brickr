/**
 * Path builders and handle validation shared across `app/` and `features/`
 * (CLAUDE.md §66.2).
 *
 * Routing itself is not a single hand-matched dispatcher anymore. `AppShell`
 * (§13.5, Issue #48) keeps the feed and every opened room permanently in the
 * tree - each is reached by comparing `location.pathname` directly, never by
 * mounting a different element per view - while `AppRoutes` is an ordinary
 * `<Routes>` tree for every other screen (cast, room list, settings, a
 * profile, post detail, legacy redirects). This module only builds and
 * validates the strings both sides navigate to.
 */
import { HANDLE_PATTERN, isReservedHandle } from "@brickr/shared";

const HANDLE_REGEXP = new RegExp(HANDLE_PATTERN);

export function postPath(postId: string): string {
  return `/posts/${encodeURIComponent(postId)}`;
}

export function handlePath(handle: string): string {
  return `/${encodeURIComponent(handle)}`;
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

/**
 * Normalizes a raw `:handle` route param into a handle safe to resolve, or
 * `null` if it can never name an account.
 *
 * Same normalization as the backend's `handleParams` schema: a leading `@`
 * and mixed case are both what a user actually copies out of a timeline.
 * Reserved words (`RESERVED_HANDLES`, `packages/shared/src/handle.ts`) are
 * rejected here rather than left for the profile fetch to 404 on, so a
 * malformed or reserved segment never reaches the network.
 */
export function normalizeHandleParam(raw: string | undefined): string | null {
  if (!raw) return null;
  const candidate = raw.replace(/^@/u, "").toLowerCase();
  if (!HANDLE_REGEXP.test(candidate) || isReservedHandle(candidate)) return null;
  return candidate;
}
