import { useMemo, useState } from "react";
import type { SimulationSummaryDto } from "@enjo/shared";

import { ErrorBanner } from "../../components/ErrorBanner";
import { Icon } from "../../components/Icon";
import { Spinner } from "../../components/Spinner";

const PAGE_SIZE = 100;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export type SimulationListProps = {
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

export function SimulationList(props: SimulationListProps) {
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const pageCount = Math.max(1, Math.ceil(props.simulations.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const rows = useMemo(
    () => props.simulations.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [props.simulations, safePage],
  );

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
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <p className="text-xs text-ink-muted">{props.simulations.length.toLocaleString("ja-JP")}件</p>
        <button
          type="button"
          title="新しいシミュレーション"
          aria-label="新しいシミュレーション"
          disabled={busy}
          onClick={props.onCreate}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-strong text-white transition hover:bg-accent disabled:opacity-50"
        >
          <Icon name="plus-circle" />
        </button>
      </div>

      {props.error ? (
        <div className="p-4">
          <ErrorBanner message="シミュレーション一覧を取得できませんでした" detail={props.error} onRetry={props.onRetry} />
        </div>
      ) : null}

      {props.loading && props.simulations.length === 0 ? (
        <div className="flex justify-center py-16"><Spinner label="読み込み中…" /></div>
      ) : (
        <div className="max-h-[calc(100dvh-10rem)] overflow-auto">
          <table className="w-full table-fixed border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-surface-raised text-left text-[11px] text-ink-muted shadow-sm">
              <tr>
                <th className="w-auto px-3 py-2 font-semibold">タイトル</th>
                <th className="w-24 px-2 py-2 font-semibold">状態</th>
                <th className="w-20 px-2 py-2 text-right font-semibold">投稿数</th>
                <th className="w-40 px-2 py-2 font-semibold">作成日時</th>
                <th className="w-16 px-2 py-2"><span className="sr-only">操作</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const current = item.id === props.currentId;
                return (
                  <tr key={item.id} className="border-t border-line hover:bg-surface-hover">
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => props.onAnalyze(item.id)} className="block w-full truncate text-left font-semibold text-ink hover:text-accent">{item.title ?? "無題のシミュレーション"}</button>
                      <p className="truncate text-[10px] text-ink-faint">{item.id}</p>
                    </td>
                    <td className="px-2 py-2">
                      <span className={current ? "text-accent" : "text-ink-muted"}>
                        {current ? "表示中" : item.status === "stopped" ? "停止中" : "利用可能"}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink-muted">
                      {item.postCount.toLocaleString("ja-JP")}
                    </td>
                    <td className="px-2 py-2 text-[11px] text-ink-muted">{formatDate(item.createdAt)}</td>
                    <td className="px-2 py-2 text-center">
                      <button
                        type="button"
                        title="名前を変更"
                        aria-label={`${item.title ?? "無題のシミュレーション"}の名前を変更`}
                        onClick={() => props.onRename(item)}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-surface-hover hover:text-ink"
                      >
                        <Icon name="pencil" />
                      </button>
                      <button
                        type="button"
                        title={current ? "表示中" : "このシミュレーションを開く"}
                        aria-label={current ? "表示中" : "このシミュレーションを開く"}
                        disabled={busy || current}
                        onClick={() => void run(() => props.onSelect(item.id))}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-accent hover:bg-accent/10 disabled:text-ink-faint"
                      >
                        <Icon name="box-arrow-in-right" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 ? <p className="px-4 py-12 text-center text-sm text-ink-muted">履歴がありません。</p> : null}
        </div>
      )}

      {pageCount > 1 ? (
        <div className="flex items-center justify-center gap-3 border-t border-line px-4 py-3 text-xs">
          <button type="button" disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-full border border-line px-3 py-1 disabled:opacity-40">前へ</button>
          <span className="text-ink-muted">{safePage} / {pageCount}</span>
          <button type="button" disabled={safePage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} className="rounded-full border border-line px-3 py-1 disabled:opacity-40">次へ</button>
        </div>
      ) : null}
    </section>
  );
}
