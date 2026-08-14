import type { SimulationDto } from "@brickr/shared";

/**
 * Every denial in the access matrix (§6.3) redirects to the feed - never a
 * distinct 403 screen. This mirrors the backend, which already answers a
 * stopped room a stranger has no business seeing with a 404 rather than an
 * explanation (CLAUDE.md §66.3): hiding that the room exists at all, not
 * just refusing to show it.
 */
export type AccessDecision = { allowed: true } | { allowed: false; redirectTo: "/" };

const ALLOWED: AccessDecision = { allowed: true };
const DENIED: AccessDecision = { allowed: false, redirectTo: "/" };

/**
 * A signed-in visitor may open any active room; a stopped one only opens for
 * its creator or an administrator (§6.3). `room: null` stands in for "the
 * fetch came back 404/403" - the caller derives it from `ApiError`, this
 * function does not talk to the network itself.
 */
export function checkRoomAccess(
  room: Pick<SimulationDto, "status" | "createdByUserId"> | null,
  currentUser: { id: string; isAdmin: boolean } | null,
): AccessDecision {
  if (currentUser === null) return DENIED;
  if (room === null) return DENIED;
  if (room.status === "active") return ALLOWED;
  const canManage = currentUser.isAdmin || room.createdByUserId === currentUser.id;
  return canManage ? ALLOWED : DENIED;
}

/** Sections gated to an administrator under `/settings/*` (§6.1). */
const ADMIN_ONLY_SETTINGS_SECTIONS = new Set(["runtime", "users", "invites"]);

export function checkAdminSettingsAccess(
  section: string,
  currentUser: { isAdmin: boolean } | null,
): AccessDecision {
  if (!ADMIN_ONLY_SETTINGS_SECTIONS.has(section)) return ALLOWED;
  return currentUser?.isAdmin ? ALLOWED : DENIED;
}

/** `/cast`, `/rooms`, `/:handle`, and the non-admin `/settings/*` sections all just need a session. */
export function checkSignedInOnlyAccess(currentUser: unknown): AccessDecision {
  return currentUser === null || currentUser === undefined ? DENIED : ALLOWED;
}
