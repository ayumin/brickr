import { type ReactNode, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { Spinner } from "../components/Spinner";
import { roomPath } from "../routes";
import { api, isAbortError, isForbiddenError, isUnauthorizedError, ApiError } from "../services/api-client";
import { useAuth } from "../features/auth/AuthContext";
import { clearSelectedRoomId, readSelectedRoomId } from "../features/rooms/selected-room-storage";
import { decideSessionRestore } from "./session-restore";

/**
 * Replaces the old `RoomBootstrap` (§13.3): resolves the session, then
 * - signed out: shows whatever the URL says (subject to each screen's own
 *   access check) - never creates a Room, never reads the stored room.
 * - signed in, explicit URL: honored as-is.
 * - signed in, landing on `/`: the stored room (if any) is checked exactly
 *   once, at launch, and restored via `replace` if still accessible; an
 *   inaccessible one is dropped rather than retried on a later visit to `/`.
 *
 * Deliberately thin: `/login` and `/signup` are separate sibling routes in
 * `App.tsx` and never pass through here, so a signed-out visitor can always
 * reach them regardless of what this component is doing.
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  // The restoration check runs once per app launch, not on every later visit
  // to "/" - e.g. clicking away from a restored room and back to the feed
  // must not immediately bounce the visitor back into it.
  const hasCheckedRef = useRef(false);

  useEffect(() => {
    if (loading || hasCheckedRef.current) return;
    hasCheckedRef.current = true;

    const decision = decideSessionRestore(user !== null, location.pathname, readSelectedRoomId());
    if (decision.action === "none") {
      setReady(true);
      return;
    }

    const storedRoomId = readSelectedRoomId();
    if (storedRoomId === null) {
      setReady(true);
      return;
    }

    const controller = new AbortController();
    api
      .getRoom(storedRoomId, controller.signal)
      .then(() => {
        navigate(roomPath(storedRoomId), { replace: true });
      })
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return;
        if (isUnauthorizedError(cause) || isForbiddenError(cause) || (cause instanceof ApiError && cause.isNotFound)) {
          // Gone, or no longer readable: nothing left to restore later either.
          clearSelectedRoomId();
        }
        // Any other error (network) leaves the stored id alone - a transient
        // failure should not discard an otherwise-valid room.
      })
      .finally(() => setReady(true));
    return () => controller.abort();
    // Deliberately depends only on `loading`: the check itself runs at most
    // once (guarded by `hasCheckedRef`), so `user`/`location`/`navigate`
    // changing afterward must not re-trigger it.
  }, [loading]);

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return children;
}
