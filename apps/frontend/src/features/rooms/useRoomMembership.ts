import { useCallback, useEffect, useState } from "react";
import type { RoomMembershipDto } from "@brickr/shared";

import { ApiError, api, isAbortError } from "../../services/api-client";
import { useAuth } from "../auth/AuthContext";

export type RoomMembershipState =
  | { status: "loading" }
  | { status: "none" }
  | { status: "ready"; membership: RoomMembershipDto };

/**
 * Fetches the current user's membership in a room (issue #178).
 *
 * Used to determine whether to show the invitation card, join request button,
 * or leave button. Returns `null` when the user has no membership row.
 *
 * Note: this queries the memberships list endpoint which requires owner/admin
 * access. For non-owners, we derive membership state from the room's
 * `capabilities` field instead (server-computed). This hook is only used
 * when `canManage` is true (owner/admin context).
 */
export function useRoomMembership(
  roomId: string,
  userId: string | undefined,
): { membership: RoomMembershipDto | null; loading: boolean; reload: () => void } {
  const [state, setState] = useState<RoomMembershipState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((v) => v + 1), []);

  useEffect(() => {
    if (!userId) {
      setState({ status: "none" });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    api
      .getRoomMemberships(roomId, controller.signal)
      .then((memberships) => {
        const mine = memberships.find(
          (m) => m.memberKind === "user" && m.memberId === userId,
        );
        setState(mine ? { status: "ready", membership: mine } : { status: "none" });
      })
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return;
        // If we can't fetch memberships (e.g. not owner), treat as no membership
        setState({ status: "none" });
      });
    return () => controller.abort();
  }, [roomId, userId, reloadToken]);

  return {
    membership: state.status === "ready" ? state.membership : null,
    loading: state.status === "loading",
    reload,
  };
}

/**
 * Hook for non-owner members: derives membership state from the room's
 * `capabilities` field (server-computed) without an extra API call.
 *
 * Returns whether the caller has a pending request (derived from the fact
 * that `canJoin` is false but the room is joinable — meaning they already
 * have a pending membership).
 */
export function useMyMembershipState(room: {
  capabilities?: {
    canJoin: boolean;
    canLeave: boolean;
    canPost: boolean;
  };
  visibility: string;
  status: string;
}): {
  hasPendingRequest: boolean;
  isActiveMember: boolean;
} {
  const caps = room.capabilities;
  if (!caps) {
    return { hasPendingRequest: false, isActiveMember: false };
  }

  // If canLeave is true, the user is an active member
  const isActiveMember = caps.canLeave;

  // If canJoin is false for an open room (not archived, not active member,
  // not banned), the user likely has a pending request. We can't know for
  // certain without querying the membership, but this is a reasonable heuristic.
  // The server will return the correct state when the user tries to withdraw.
  // Note: for closed/private rooms, canJoin is always false (invitation only),
  // so we only check open rooms here.
  const isOpen = room.visibility === "open";
  const isActive = room.status === "active";
  const hasPendingRequest =
  const hasPendingRequest =
    isActive && isOpen && !caps.canJoin && !isActiveMember && !caps.canManage;
  return { hasPendingRequest, isActiveMember };
}

/**
 * Hook to check if the current user has a pending invitation in a room.
 * Fetches the invitation details from the server.
 */
export function useMyInvitation(roomId: string): {
  hasInvitation: boolean;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const { user } = useAuth();
  const [hasInvitation, setHasInvitation] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((v) => v + 1), []);

  useEffect(() => {
    if (!user) {
      setHasInvitation(false);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api
      .getRoomInvitation(roomId, controller.signal)
      .then(() => {
        setHasInvitation(true);
      })
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return;
        if (cause instanceof ApiError && cause.isNotFound) {
          // 404 means no invitation — not an error
          setHasInvitation(false);
        } else {
          setError(cause instanceof Error ? cause.message : "招待状の取得に失敗しました");
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [roomId, user, reloadToken]);

  return { hasInvitation, loading, error, reload };
}
