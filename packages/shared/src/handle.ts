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
