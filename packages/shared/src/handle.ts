import type { CharacterDto } from "./character.js";
import type { UserProfileDto } from "./user-profile.js";

/**
 * Resolution of a handle from the namespace users and characters share
 * (CLAUDE.md §66.13).
 *
 * The user arm carries `UserProfileDto`, not the signed-in user shape: a handle
 * lookup is public, so it must not expose `isAdmin` or `status`.
 */
export type HandleOwnerDto =
  | { ownerType: "user"; user: UserProfileDto }
  | { ownerType: "character"; character: CharacterDto };

export type HandleResponse = {
  owner: HandleOwnerDto;
};

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
  // Routes the app serves today.
  "login", "signup", "logout", "admin", "settings",
  "characters", "simulations", "posts",
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
