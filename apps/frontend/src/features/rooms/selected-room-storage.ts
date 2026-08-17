import { STORAGE_KEYS, clearStored, readStored, writeStored } from "../../services/local-storage";

/**
 * The room to restore on the next visit (§7.1). `null` means the unified feed.
 *
 * A signed-out visitor never has this read: `SessionGate` only checks it for a
 * signed-in session on `/`, per §13.3 — nothing here enforces that on its own.
 */
export function readSelectedRoomId(): string | null {
  return readStored(STORAGE_KEYS.selectedRoomId);
}

export function writeSelectedRoomId(roomId: string): void {
  writeStored(STORAGE_KEYS.selectedRoomId, roomId);
}

/** Explicitly opening the feed, or the stored room turning out inaccessible, both clear this (§7.1). */
export function clearSelectedRoomId(): void {
  clearStored(STORAGE_KEYS.selectedRoomId);
}
