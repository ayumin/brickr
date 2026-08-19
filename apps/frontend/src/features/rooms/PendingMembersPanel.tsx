import { useCallback, useEffect, useState } from "react";
import type { RoomMembershipDto } from "@brickr/shared";

import { ErrorBanner } from "../../components/ErrorBanner";
import { Spinner } from "../../components/Spinner";
import { api, isAbortError, toErrorMessage } from "../../services/api-client";

export type PendingMembersPanelProps = {
  roomId: string;
  /** Called after an approval or rejection so the parent can refresh the room. */
  onChanged: () => void;
};

type ActionState = { memberId: string; action: "approve" | "reject" } | null;

/**
 * Owner-facing panel for managing pending join requests (issue #178).
 *
 * Shows all pending memberships for the room. The owner can approve or reject
 * each request. Only rendered when `canManage` is true (enforced by the parent).
 */
export function PendingMembersPanel({ roomId, onChanged }: PendingMembersPanelProps) {
  const [memberships, setMemberships] = useState<RoomMembershipDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionState, setActionState] = useState<ActionState>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((v) => v + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api
      .getRoomMemberships(roomId, controller.signal)
      .then((all) => {
        // Filter to only pending memberships with origin=request (join requests)
        setMemberships(all.filter((m) => m.status === "pending" && m.origin === "request"));
      })
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return;
        setError(toErrorMessage(cause));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [roomId, reloadToken]);

  const handleApprove = async (memberId: string): Promise<void> => {
    setActionState({ memberId, action: "approve" });
    setActionError(null);
    try {
      await api.approveRoomMembership(roomId, memberId);
      reload();
      onChanged();
    } catch (cause) {
      setActionError(toErrorMessage(cause));
    } finally {
      setActionState(null);
    }
  };

  const handleReject = async (memberId: string): Promise<void> => {
    setActionState({ memberId, action: "reject" });
    setActionError(null);
    try {
      await api.removeRoomMembership(roomId, memberId);
      reload();
      onChanged();
    } catch (cause) {
      setActionError(toErrorMessage(cause));
    } finally {
      setActionState(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-4">
        <Spinner size="sm" />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorBanner
        message="参加申請を取得できませんでした"
        detail={error}
        onRetry={reload}
      />
    );
  }

  if (memberships.length === 0) {
    return (
      <p className="py-2 text-xs text-ink-faint">承認待ちの参加申請はありません</p>
    );
  }

  return (
    <div className="space-y-2">
      {actionError ? (
        <ErrorBanner
          message="操作できませんでした"
          detail={actionError}
          onDismiss={() => setActionError(null)}
        />
      ) : null}
      {memberships.map((m) => {
        const isActing = actionState?.memberId === m.memberId;
        return (
          <div
            key={m.id}
            className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-ink">{m.memberId}</p>
              <p className="text-[11px] text-ink-faint">
                申請日: {new Date(m.createdAt).toLocaleDateString("ja-JP")}
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <button
                type="button"
                disabled={isActing}
                onClick={() => void handleApprove(m.memberId)}
                className="rounded-full bg-accent-strong px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-accent disabled:opacity-50"
              >
                {isActing && actionState?.action === "approve" ? (
                  <Spinner size="sm" />
                ) : (
                  "承認"
                )}
              </button>
              <button
                type="button"
                disabled={isActing}
                onClick={() => void handleReject(m.memberId)}
                className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-muted transition hover:bg-surface-hover disabled:opacity-50"
              >
                {isActing && actionState?.action === "reject" ? (
                  <Spinner size="sm" />
                ) : (
                  "拒否"
                )}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
