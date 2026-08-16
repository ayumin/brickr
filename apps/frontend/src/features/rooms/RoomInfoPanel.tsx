import { useState } from "react";
import type { SimulationSummaryDto } from "@brickr/shared";

import { ErrorBanner } from "../../components/ErrorBanner";
import { Icon } from "../../components/Icon";
import { Spinner } from "../../components/Spinner";
import { toErrorMessage } from "../../services/api-client";

export type RoomInfoContentProps = {
  simulation: SimulationSummaryDto;
  onOpenAnalysis: () => void;
  onRename: () => void;
  onStop: () => Promise<void>;
  onResume: () => Promise<void>;
  /** Lets `RoomInfoSheet` disable its `Dialog`'s backdrop/Escape close while a stop/resume request is in flight (CLAUDE.md §50). */
  onBusyChange?: (busy: boolean) => void;
};

/**
 * The room info content (§19.2), shared by the desktop `RoomInfoPanel` and
 * the mobile `RoomInfoSheet` — phase 1 shows only room name / creator / post
 * count / a link to the detailed analysis / rename / pause-resume, all
 * gated by the server's own `canManage` (never re-derived here). Topic, cast
 * roster, temperature, depth, concurrency, and an AI summary are all
 * deliberately absent — none of them exist yet, and an inert control for one
 * would be exactly the "見せかけの設定" the ground rules ban.
 */
export function RoomInfoContent({
  simulation,
  onOpenAnalysis,
  onRename,
  onStop,
  onResume,
  onBusyChange,
}: RoomInfoContentProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
        </div>
      ) : null}

      {error ? <ErrorBanner message="操作できませんでした" detail={error} onDismiss={() => setError(null)} /> : null}
    </div>
  );
}

export type RoomInfoPanelProps = RoomInfoContentProps;

/** Desktop sticky right panel (§14.1: ~264–300px, room screens only). */
export function RoomInfoPanel(props: RoomInfoPanelProps) {
  return (
    <aside className="sticky top-0 hidden h-fit w-[280px] shrink-0 border-l border-line lg:block">
      <RoomInfoContent {...props} />
    </aside>
  );
}
