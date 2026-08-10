import { useEffect, useState } from "react";
import type { SimulationSummaryDto } from "@brickr/shared";

import { ErrorBanner } from "../../components/ErrorBanner";
import { Icon } from "../../components/Icon";
import { Spinner } from "../../components/Spinner";

const PAGE_SIZE = 100;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export type SimulationPickerProps = {
  simulations: SimulationSummaryDto[];
  currentId: string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelect: (id: string) => Promise<void>;
  onCreate: () => void;
  onRename: (simulation: SimulationSummaryDto) => void;
  onAnalyze: (id: string) => void;
};

export function SimulationPicker({
  simulations,
  currentId,
  loading,
  error,
  onRetry,
  onSelect,
  onCreate,
  onRename,
  onAnalyze,
}: SimulationPickerProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [busy, setBusy] = useState(false);

  useEffect(() => setVisibleCount(PAGE_SIZE), [simulations.length]);

  const run = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await operation();
    } catch {
      // App owns and displays operation errors in the shared error banner.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-surface">
      <div className="border-b border-line p-3">
        <button
          type="button"
          disabled={busy}
          onClick={onCreate}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-accent-strong px-3 py-2 text-xs font-semibold text-white transition hover:bg-accent disabled:opacity-50"
        >
          <Icon name="plus-circle" />
          新しいシミュレーション
        </button>
      </div>

      {error ? (
        <div className="p-3">
          <ErrorBanner message="履歴を取得できませんでした" detail={error} onRetry={onRetry} />
        </div>
      ) : null}

      {loading && simulations.length === 0 ? (
        <div className="flex justify-center px-4 py-8"><Spinner size="sm" label="読み込み中…" /></div>
      ) : simulations.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-muted">シミュレーション履歴がありません。</p>
      ) : (
        <ul className="max-h-[60vh] overflow-y-auto p-2 lg:max-h-[calc(100dvh-16rem)]">
          {simulations.slice(0, visibleCount).map((item) => {
            const selected = item.id === currentId;
            return (
              <li key={item.id}>
                <div
                  aria-current={selected}
                  className={`rounded-xl px-3 py-2 transition ${
                    selected ? "bg-accent/12 ring-1 ring-accent/40" : "hover:bg-surface-hover"
                  }`}
                >
                  <button type="button" onClick={() => onAnalyze(item.id)} className="block w-full truncate text-left text-sm font-semibold text-ink hover:text-accent">
                    {item.title ?? "無題のシミュレーション"}
                  </button>
                  <span className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-faint">
                    <span>{formatDate(item.createdAt)}</span>
                    <span className="ml-auto">{item.postCount.toLocaleString("ja-JP")}件</span>
                    <button type="button" onClick={() => onRename(item)} title="名前を変更" aria-label={`${item.title ?? "無題のシミュレーション"}の名前を変更`} className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-surface-raised hover:text-ink">
                      <Icon name="pencil" />
                    </button>
                    <button type="button" disabled={busy || selected} onClick={() => void run(() => onSelect(item.id))} title={selected ? "表示中" : "このシミュレーションを開く"} aria-label={selected ? "表示中" : "このシミュレーションを開く"} className="flex h-7 w-7 items-center justify-center rounded-full text-accent hover:bg-accent/10 disabled:text-ink-faint">
                      <Icon name="box-arrow-in-right" />
                    </button>
                  </span>
                </div>
              </li>
            );
          })}
          {visibleCount < simulations.length ? (
            <li className="px-2 py-3 text-center">
              <button
                type="button"
                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                className="rounded-full border border-line px-4 py-1.5 text-xs font-semibold text-accent hover:bg-accent/10"
              >
                さらに表示
              </button>
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}
