import { useState } from "react";
import type { RoomSummaryDto } from "@brickr/shared";

import { Dialog } from "../../components/Dialog";
import { Icon } from "../../components/Icon";
import { Spinner } from "../../components/Spinner";
import { api, toErrorMessage } from "../../services/api-client";

export type LeaveRoomButtonProps = {
  room: RoomSummaryDto;
  /** Called after successfully leaving the room so the parent can navigate away or refresh. */
  onLeft: () => void;
};

/**
 * Leave room button for active members (issue #178).
 *
 * Only rendered when `capabilities.canLeave` is true (server-computed).
 * Requires a confirmation dialog before leaving, since the action transitions
 * the membership to `left` and disconnects the SSE stream.
 */
export function LeaveRoomButton({ room, onLeft }: LeaveRoomButtonProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canLeave = room.capabilities?.canLeave ?? false;
  if (!canLeave) return null;

  const handleLeave = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.leaveRoom(room.id);
      setConfirmOpen(false);
      onLeft();
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className="flex w-full items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm text-danger transition hover:bg-danger/10"
      >
        <Icon name="person-x" />
        退会する
      </button>

      {confirmOpen ? (
        <Dialog
          titleId="leave-room-dialog-title"
          title="ルームから退会"
          onClose={() => setConfirmOpen(false)}
          closeDisabled={busy}
        >
          <div className="p-5">
            <p className="text-sm text-ink">
              「{room.title ?? "無題のルーム"}」から退会しますか？
              過去の投稿は残ります。再参加するには参加申請が必要になる場合があります。
            </p>
            {error ? (
              <p className="mt-3 text-sm text-danger">{error}</p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={busy}
                className="rounded-full border border-line px-4 py-2 text-sm text-ink-muted hover:bg-surface-hover disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleLeave()}
                className="rounded-full bg-danger-strong px-4 py-2 text-sm font-semibold text-white hover:bg-danger disabled:opacity-50"
              >
                {busy ? (
                  <span className="flex items-center gap-2">
                    <Spinner size="sm" />
                    処理中…
                  </span>
                ) : (
                  "退会する"
                )}
              </button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
