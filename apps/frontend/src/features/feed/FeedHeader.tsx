import type { FeedFilter } from "@brickr/shared";

import { Spinner } from "../../components/Spinner";
import { FeedFilters } from "./FeedFilters";

export type FeedHeaderProps = {
  title: string;
  subtitle?: string;
  /** Anonymous "a response is coming" indicator (§11.2, §16.1) — count only, never who. */
  activeResponseCount: number;
  /** Hidden entirely for an unauthenticated reader, who has no "mine" concept (§10.1, §16.3). */
  showFilters: boolean;
  filter: FeedFilter;
  onFilterChange: (filter: FeedFilter) => void;
};

/** The unified feed's header (§16.1): title, generation indicator, and the `すべて／自分あて` filter. */
export function FeedHeader({
  title,
  subtitle,
  activeResponseCount,
  showFilters,
  filter,
  onFilterChange,
}: FeedHeaderProps) {
  return (
    <header className="border-b border-line">
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate font-display text-lg font-bold text-ink">{title}</h1>
          {subtitle ? <p className="text-xs text-ink-faint">{subtitle}</p> : null}
        </div>
        {activeResponseCount > 0 ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface-raised px-2.5 py-1 text-[11px] text-ink-muted">
            <Spinner size="sm" />
            応答を生成中
          </span>
        ) : null}
      </div>

      {showFilters ? <FeedFilters active={filter} onChange={onFilterChange} /> : null}
    </header>
  );
}
