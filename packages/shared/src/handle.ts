/**
 * There is deliberately no handle-owner DTO here any more (§10.6).
 *
 * `GET /api/handles/:handle` used to answer with a discriminated union carrying
 * `ownerType: "user" | "character"`, so resolving any handle said outright whether
 * it belonged to a person or to an AI — the one thing the public surface must
 * never state (§25). Both the endpoint and the type are gone;
 * `GET /api/profiles/:handle` returns a `PublicProfileDto` instead, with the same
 * shape whichever half of the shared namespace holds the handle.
 */

/**
 * Handles that no user or character may take, because a bare `/handle` URL is
 * the profile route (§66.2) and these paths mean something else.
 *
 * This list can only ever grow at the cost of breaking whoever already holds a
 * newly-added word, so it is deliberately wider than what the app serves today:
 * the words are cheap now and expensive later. `you` is absent because it is an
 * ordinary handle again: the pre-login account that held it is gone, and posting
 * now always belongs to a signed-in account (§8.2).
 */
export const RESERVED_HANDLES: readonly string[] = [
  // Routes the app serves today. `rooms` and `cast` are the refreshed names for
  // the room list and character management (§6.1); `characters` and `simulations`
  // stay reserved because the old URLs keep redirecting during phase 1 (§6.2).
  //
  // `admin` is deliberately absent: there is no `/admin` route in §6.1 (admin
  // screens live under `/settings/*`), and `ADMIN_HANDLE` defaults to exactly
  // this word (CLAUDE.md §66.9) - reserving it made the bootstrap admin's own
  // `/:handle` profile permanently unreachable for no corresponding route.
  "login", "signup", "logout", "settings",
  "characters", "simulations", "posts", "rooms", "cast",
  // Settings sections (§6.3, §22). They live under the already-reserved
  // `settings` prefix, so none of them can collide today — they are listed for
  // the same reason as everything else here: a word is cheap to reserve now and
  // expensive once somebody holds it, and each of these is a plausible
  // top-level page later.
  "profile", "appearance", "usage", "runtime", "users", "invites",
  // Phase 2 auth flows: OAuth and magic links (§66.8), and the password reset
  // that §66.10 deliberately leaves out for now.
  "auth", "callback", "oauth", "verify", "confirm", "reset", "password",
  // Would collide with backend or asset paths on a single origin.
  "api", "assets", "static", "public", "health", "documentation",
  // Pages almost every app grows eventually.
  "home", "about", "terms", "privacy", "help", "support",
  "search", "explore", "notifications", "messages", "new", "edit",
  // `me` is unreachable anyway under the 3-character minimum; kept in case that
  // minimum is ever lowered. `system` would misrepresent a System-owned
  // character (§66.14); `brickr` the product itself.
  "me", "system", "brickr",
];

const reservedHandles = new Set(RESERVED_HANDLES);

/** Handles are already lower-cased by validation, so an exact match is enough. */
export function isReservedHandle(handle: string): boolean {
  return reservedHandles.has(handle.trim().toLowerCase());
}
