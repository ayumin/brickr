import { THEME_OPTIONS, type Theme } from "../../services/theme";

/** `/settings/appearance` (§22): the brand-theme picker. */
export function AppearanceSettings({
  theme,
  onThemeChange,
}: {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {THEME_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onThemeChange(option.id)}
          aria-pressed={theme === option.id}
          className={`rounded-xl border p-3 text-left text-sm transition ${
            theme === option.id
              ? "border-accent bg-accent/10 font-semibold text-accent"
              : "border-line text-ink-muted hover:border-line-strong hover:text-ink"
          }`}
        >
          <span className="mb-2 flex overflow-hidden rounded-full border border-black/10" aria-hidden="true">
            {option.swatches.map((color) => (
              <span key={color} className="h-4 flex-1" style={{ backgroundColor: color }} />
            ))}
          </span>
          {option.label}
        </button>
      ))}
      <p className="col-span-full text-xs text-ink-faint">テーマの変更はすぐに保存されます。</p>
    </div>
  );
}
