import type { HandleOwnerType } from "@brickr/shared";

/**
 * A row of the handle namespace users and characters share (CLAUDE.md §66.13).
 *
 * The domain models stay separate (§4). This exists only so uniqueness is a
 * database constraint rather than application logic, and so a handle can be
 * resolved back to whoever holds it.
 */
export type HandleOwner = {
  handle: string;
  ownerType: HandleOwnerType;
  ownerId: string;
};

export class HandleTakenError extends Error {
  constructor(handle: string) {
    super(`handle @${handle} is already taken`);
    this.name = "HandleTakenError";
  }
}

/** Handles are stored lower-cased and without the display-only `@` prefix. */
export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/u, "").toLowerCase();
}
