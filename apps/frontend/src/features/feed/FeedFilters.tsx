import type { FeedFilter } from "@brickr/shared";

type FeedFiltersProps = {
  active: FeedFilter;
  onChange: (filter: FeedFilter) => void;
};

/**
 * `すべて／自分あて` filter tabs (§12.3).
 *
 * Only rendered for authenticated users — an unauthenticated reader has no
 * "mine" concept, so the filter is hidden entirely rather than shown disabled
 * (§10.1, §16.3).
 */
export function FeedFilters({ active, onChange }: FeedFiltersProps) {
  return (
    <div className="flex border-b border-line" role="tablist" aria-label="フィードフィルター">
      <FilterTab label="すべて" value="all" active={active} onChange={onChange} />
      <FilterTab label="自分あて" value="mine" active={active} onChange={onChange} />
    </div>
  );
}

function FilterTab({
  label,
  value,
  active,
  onChange,
}: {
  label: string;
  value: FeedFilter;
  active: FeedFilter;
  onChange: (filter: FeedFilter) => void;
}) {
  const isActive = active === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={() => onChange(value)}
      className={`flex-1 py-3 text-sm font-medium transition-colors ${
        isActive
          ? "border-b-2 border-accent text-accent"
          : "text-ink-muted hover:bg-surface-hover/60 hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}
