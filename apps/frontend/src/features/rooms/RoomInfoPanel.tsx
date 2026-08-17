import { useState } from "react";
import type { RoomSummaryDto } from "@brickr/shared";

import { Dialog } from "../../components/Dialog";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Icon } from "../../components/Icon";
import { Spinner } from "../../components/Spinner";
import { toErrorMessage } from "../../services/api-client";
import { RoomAnalysisPanel } from "./RoomAnalysisPanel";

export type RoomInfoContentProps = {
  simulation: RoomSummaryDto;
  onOpenAnalysis: () => void;
  onRename: () => void;
  onStop: () => Promise<void>;
  onResume: () => Promise<void>;
  onArchive: () => Promise<void>;
  onDelete: () => Promise<void>;
  /** Lets `RoomInfoSheet` disable its `Dialog`'s backdrop/Escape close while a stop/resume request is in flight (CLAUDE.md §50). */
  onBusyChange?: (busy: boolean) => void;
};

type ConfirmDialog =
  | { kind: "archive" }
  | { kind: "delete" };

/**
 * The room info content (§19.2), shared by the desktop `RoomInfoPanel` and
 * the mobile `RoomInfoSheet` — shows room name / creator / post count / a
 * link to the detailed analysis / rename / pause-resume / archive / delete,
 * all gated by the server's own `canManage` (never re-derived here).
 *
 * Archive and delete require confirmation dialogs (issue #169: "archive/delete
 * は確認ダイアログ必須"). Delete is only available for archived rooms.
 */
export function RoomInfoContent({
  simulation,
  onOpenAnalysis,
  onRename,
  onStop,
  onResume,
  onArchive,
  onDelete,
  onBusyChange,
}: RoomInfoContentProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const isStopped = simulation.status === "archived";

  const run = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true);
    onBusyChange?.(true);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  const handleConfirm = async (): Promise<void> => {
    if (!confirmDialog) return;
    const operation = confirmDialog.kind === "archive" ? onArchive : onDelete;
    setConfirmDialog(null);
    await run(operation);
  };

  return (
    <div className="space-y-4 p-4">
      <div>
        <h2 className="truncate text-base font-bold text-ink">{simulation.title ?? "無題のルーム"}</h2>
        <p className="mt-1 text-xs text-ink-faint">
          作成者: {simulation.creator ? `@${simulation.creator.handle}` : "不明"}
        </p>
        <p className="text-xs text-ink-faint">投稿数: {simulation.postCount.toLocaleString("ja-JP")}</p>
      </div>

      {simulation.canManage ? (
        <button
          type="button"
          onClick={onOpenAnalysis}
          className="flex w-full items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm text-ink-muted transition hover:bg-surface-hover hover:text-ink"
        >
          <Icon name="clipboard" />
          詳細分析を見る
        </button>
      ) : null}

      {simulation.canManage ? (
        <div className="space-y-2 border-t border-line pt-4">
          <button
            type="button"
            disabled={busy}
            onClick={onRename}
            className="flex w-full items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm text-ink-muted transition hover:bg-surface-hover hover:text-ink disabled:opacity-50"
          >
            <Icon name="pencil" />
            名前を変更
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => void run(isStopped ? onResume : onStop)}
            className="flex w-full items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm text-ink-muted transition hover:bg-surface-hover hover:text-ink disabled:opacity-50"
          >
            {busy ? <Spinner size="sm" /> : <Icon name={isStopped ? "play-circle" : "pause-circle"} />}
            {isStopped ? "再開する" : "一時停止する"}
          </button>

          {/* Archive — only for active rooms */}
          {!isStopped ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmDialog({ kind: "archive" })}
              className="flex w-full items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm text-ink-muted transition hover:bg-surface-hover hover:text-ink disabled:opacity-50"
            >
              <Icon name="clock-history" />
              アーカイブする
            </button>
          ) : null}

          {/* Delete — only for archived rooms */}
          {isStopped ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmDialog({ kind: "delete" })}
              className="flex w-full items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm text-error transition hover:bg-error/10 disabled:opacity-50"
            >
              <Icon name="trash" />
              削除する
            </button>
          ) : null}
        </div>
      ) : null}

      {error ? <ErrorBanner message="操作できませんでした" detail={error} onDismiss={() => setError(null)} /> : null}

      {/* Confirmation dialog for archive/delete */}
      {confirmDialog ? (
        <Dialog
          titleId="room-confirm-dialog-title"
          title={confirmDialog.kind === "archive" ? "ルームをアーカイブ" : "ルームを削除"}
          onClose={() => setConfirmDialog(null)}
          closeDisabled={busy}
        >
          <div className="p-5">
            <p className="text-sm text-ink">
              {confirmDialog.kind === "archive"
                ? "このルームをアーカイブしますか？アーカイブ後は投稿できなくなります。後から再開することもできます。"
                : "このルームを完全に削除しますか？この操作は取り消せません。ルーム内のすべての投稿も削除されます。"}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                disabled={busy}
                className="rounded-full border border-line px-4 py-2 text-sm text-ink-muted hover:bg-surface-hover disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleConfirm()}
                className={`rounded-full px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                  confirmDialog.kind === "delete"
                    ? "bg-error hover:bg-error/80"
                    : "bg-accent-strong hover:bg-accent"
                }`}
              >
                {busy ? (
                  <span className="flex items-center gap-2">
                    <Spinner size="sm" />
                    処理中…
                  </span>
                ) : confirmDialog.kind === "archive" ? (
                  "アーカイブする"
                ) : (
                  "削除する"
                )}
              </button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

export type RoomInfoPanelProps = RoomInfoContentProps;

/** Desktop sticky right panel (§14.1: ~264–300px, room screens only). */
export function RoomInfoPanel(props: RoomInfoPanelProps) {
  return (
    <aside className="sticky top-0 hidden h-fit w-[280px] shrink-0 border-l border-line lg:block">
      <RoomInfoContent {...props} />
      <RoomAnalysisPanel simulation={props.simulation} />
    </aside>
  );
}
