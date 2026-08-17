/**
 * Every LocalStorage key the app uses, in one place (§7).
 *
 * Collected here because the alternative is a string literal in whichever module
 * happened to need it: two spellings of the same key are indistinguishable at a
 * glance and produce a setting that silently stops persisting.
 *
 * Nothing stored here is an account attribute. These are per-device preferences,
 * which is why they are not on the server: a signed-out visitor still gets their
 * theme, and no reload has to wait for a request to know what to paint (§15.2).
 */
export const STORAGE_KEYS = {
  /** `brickr-dark | brickr-light`. Absent means "follow the OS" (§7.3). */
  theme: "brickr.theme",
  /** The room to restore on the next visit; absent means the unified feed (§7.1). */
  selectedRoomId: "brickr.selectedRoomId",
  /** `all | mine`, shared by the feed and by one room (§7.2). */
  feedFilter: "brickr.feedFilter",
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/**
 * Reads a key, or `null` when it is absent *or* unreadable.
 *
 * Storage throws rather than returning null in private modes and when a browser
 * blocks it entirely, so every access goes through here: a blocked preference is
 * a preference the app does without, never an error a screen has to render.
 */
export function readStored(key: StorageKey): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Reads a key and checks it against the values this version understands.
 *
 * An unrecognised value is treated as absent, which is what makes a stored
 * setting from an older build harmless: the eight theme ids this app used to
 * offer no longer exist, and the one that survives in somebody's browser has to
 * fall back to the OS preference rather than paint an undefined theme (§15.2).
 */
export function readStoredOneOf<T extends string>(
  key: StorageKey,
  allowed: readonly T[],
): T | null {
  const stored = readStored(key);
  return allowed.includes(stored as T) ? (stored as T) : null;
}

/** Writing is best-effort: a blocked store costs persistence, not the feature. */
export function writeStored(key: StorageKey, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignored on purpose - see readStored.
  }
}

export function clearStored(key: StorageKey): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignored on purpose - see readStored.
  }
}
