import { useState } from "react";
import type { PendingInvitationDto } from "@brickr/shared";

import { ErrorBanner } from "../../components/ErrorBanner";
import { Spinner } from "../../components/Spinner";
import { api, toErrorMessage } from "../../services/api-client";

/** Human-readable label for each visibility level. */
const VISIBILITY_LABEL: Record<string, string> = {
  public: "パブリック",
  open: "オープン",
  closed: "クローズド",
  private: "プライベート",
};

export type InvitationCardProps = {
  invitation: PendingInvitationDto;
  /** Called after the invitation is accepted or declined so the parent can refresh. */
  onDone: () => void;
};

/**
 * A card shown to a user who has a pending room invitation (issue #178).
 *
 * Displays the room title, visibility, owner, and member count so the invitee
 * can make an informed decision. Provides accept and decline actions.
 */
export function InvitationCard({ invitation, onDone }: InvitationCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAccept = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.acceptRoomInvitation(invitation.roomId);
      onDone();
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleDecline = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.declineRoomInvitation(invitation.roomId);
      onDone();
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold text-ink">
              {invitation.roomTitle ?? "無題のルーム"}
            </p>
            <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-muted">
              {VISIBILITY_LABEL[invitation.roomVisibility] ?? invitation.roomVisibility}
            </span>
            <span className="shrink-0 rounded-full bg-accent-strong px-2 py-0.5 text-[11px] font-semibold text-white">
              招待
            </span>
          </div>
          <p className="mt-1 text-xs text-ink-faint">
            <span className="font-medium text-ink-muted">@{invitation.ownerHandle}</span>
            {" "}({invitation.ownerDisplayName}) さんからの招待
          </p>
          <p className="mt-0.5 text-xs text-ink-faint">
            メンバー {invitation.activeMemberCount.toLocaleString("ja-JP")} 人
          </p>
        </div>
      </div>

      {error ? (
        <div className="mt-3">
          <ErrorBanner
            message="操作できませんでした"
            detail={error}
            onDismiss={() => setError(null)}
          />
        </div>
      ) : null}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleAccept()}
          className="flex-1 rounded-full bg-accent-strong px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-accent disabled:opacity-50"
        >
          {busy ? (
            <span className="flex items-center justify-center gap-1.5">
              <Spinner size="sm" />
              処理中…
            </span>
          ) : (
            "参加する"
          )}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleDecline()}
          className="flex-1 rounded-full border border-line px-3 py-1.5 text-sm text-ink-muted transition hover:bg-surface-hover disabled:opacity-50"
        >
          拒否する
        </button>
      </div>
    </div>
  );
}
