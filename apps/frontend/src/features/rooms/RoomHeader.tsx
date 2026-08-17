import type { FeedFilter } from "@brickr/shared";

import { Icon } from "../../components/Icon";
import { Spinner } from "../../components/Spinner";
import type { ConnectionState } from "../../types";
import { FeedFilters } from "../feed/FeedFilters";

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connecting: "接続中…",
  open: "接続済み",
  reconnecting: "再接続中…",
  disconnected: "切断中",
};

const CONNECTION_DOT: Record<ConnectionState, string> = {
  connecting: "bg-ink-faint",
  open: "bg-live",
  reconnecting: "bg-warn",
  disconnected: "bg-ink-faint",
};

function ConnectionBadge({ connection, onToggle }: { connection: ConnectionState; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface-raised px-2.5 py-1 text-[11px] text-ink-muted"
      title={connection === "disconnected" ? "Backendへ再接続" : "Backendとの接続を切断"}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${CONNECTION_DOT[connection]}`} aria-hidden="true" />
      {CONNECTION_LABEL[connection]}
    </button>
  );
}

export type RoomHeaderProps = {
  title: string;
  /** Shown as a badge next to the title — safe here (unlike the unified feed, §16.3) because only the room's owner/admin ever reaches a stopped room's screen at all. */
  isStopped: boolean;
  activeResponseCount: number;
  connection: ConnectionState;
  onToggleConnection: () => void;
  filter: FeedFilter;
  onFilterChange: (filter: FeedFilter) => void;
  /** Opens `RoomInfoSheet` — mobile only, since desktop shows `RoomInfoPanel` directly (§19.2). */
  onOpenInfo: () => void;
};

/** The room screen's header bar (§19.2): title, generation indicator, connection badge, filter, and the mobile info button. */
export function RoomHeader({
  title,
  isStopped,
  activeResponseCount,
  connection,
  onToggleConnection,
  filter,
  onFilterChange,
  onOpenInfo,
}: RoomHeaderProps) {
  return (
    <header className="border-b border-line">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <p className="truncate text-sm font-semibold text-ink">{title}</p>
          {isStopped ? (
            <span className="shrink-0 rounded-full bg-surface-raised px-2 py-0.5 text-[11px] text-ink-muted">
              停止中
            </span>
          ) : null}
        </div>
        {/* Anonymous generation indicator (§11.2, §16.1) */}
        {activeResponseCount > 0 ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface-raised px-2.5 py-1 text-[11px] text-ink-muted">
            <Spinner size="sm" />
            応答を生成中
          </span>
        ) : null}
        <ConnectionBadge connection={connection} onToggle={onToggleConnection} />
        <button
          type="button"
          onClick={onOpenInfo}
          aria-label="ルーム情報"
          title="ルーム情報"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-muted transition hover:bg-surface-hover hover:text-ink lg:hidden"
        >
          <Icon name="info-circle" />
        </button>
      </div>

      {/* すべて／自分あて filter, shared with the unified feed (§7.2, §16.1) */}
      <FeedFilters active={filter} onChange={onFilterChange} />
    </header>
  );
}
