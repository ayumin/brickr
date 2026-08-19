import { useState } from "react";
import type { RoomSummaryDto } from "@brickr/shared";

import { Spinner } from "../../components/Spinner";
import { api, toErrorMessage } from "../../services/api-client";

export type JoinRequestButtonProps = {
  room: RoomSummaryDto;
  /** Called after a successful join/withdraw so the parent can refresh. */
  onDone: () => void;
  /** Whether the caller currently has a pending join request. */
  hasPendingRequest: boolean;
};

/**
 * Join request / withdraw button for open and closed rooms (issue #178).
 *
 * - If the caller has no pending request and `capabilities.canJoin` is true:
 *   shows a "参加を申請" button.
 * - If the caller has a pending(request) membership: shows a "申請を取り下げ" button.
 *
 * The parent is responsible for passing `hasPendingRequest` (derived from the
 * membership list or the room's own membership state).
 */
export function JoinRequestButton({ room, onDone, hasPendingRequest }: JoinRequestButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canJoin = room.capabilities?.canJoin ?? false;

  // Nothing to show if neither joining nor withdrawing is possible
  if (!canJoin && !hasPendingRequest) return null;

  const handleJoin = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.joinRoom(room.id);
      onDone();
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleWithdraw = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.withdrawRoomJoinRequest(room.id);
      onDone();
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      {hasPendingRequest ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-faint">参加申請中</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleWithdraw()}
            className="rounded-full border border-line px-3 py-1 text-xs text-ink-muted transition hover:bg-surface-hover disabled:opacity-50"
          >
            {busy ? (
              <span className="flex items-center gap-1">
                <Spinner size="sm" />
                処理中…
              </span>
            ) : (
              "申請を取り下げ"
            )}
          </button>
        </div>
      ) : canJoin ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleJoin()}
          className="rounded-full border border-accent px-3 py-1 text-xs font-semibold text-accent transition hover:bg-accent hover:text-white disabled:opacity-50"
        >
          {busy ? (
            <span className="flex items-center gap-1">
              <Spinner size="sm" />
              申請中…
            </span>
          ) : (
            "参加を申請"
          )}
        </button>
      ) : null}
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : null}
    </div>
  );
}
