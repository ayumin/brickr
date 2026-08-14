/**
 * Whether the app-launch room-restoration check (§13.3) should even attempt
 * a fetch, given what is known synchronously. Split out from `SessionGate`
 * so the branch can be tested without mocking the network: a signed-out
 * visitor's stored id must never be read for this purpose (§7.1), and an
 * explicit URL is always honored as-is, whether or not a room is stored.
 */
export type SessionRestoreDecision = { action: "none" } | { action: "check-room" };

export function decideSessionRestore(
  signedIn: boolean,
  pathname: string,
  storedRoomId: string | null,
): SessionRestoreDecision {
  if (!signedIn || pathname !== "/" || storedRoomId === null) {
    return { action: "none" };
  }
  return { action: "check-room" };
}
