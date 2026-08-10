import { useState } from "react";

import { Icon } from "../../components/Icon";
import { toErrorMessage } from "../../services/api-client";

export type SimulationNameDialogProps = {
  mode: "create" | "rename";
  initialValue?: string;
  onClose: () => void;
  onSave: (title: string) => Promise<void>;
};

export function SimulationNameDialog({
  mode,
  initialValue = "",
  onClose,
  onSave,
}: SimulationNameDialogProps) {
  const [title, setTitle] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalized = title.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="simulation-name-title"
        className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (!normalized || saving) return;
          setSaving(true);
          setError(null);
          void onSave(normalized)
            .then(onClose)
            .catch((cause: unknown) => setError(toErrorMessage(cause)))
            .finally(() => setSaving(false));
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="simulation-name-title" className="text-base font-bold text-ink">
            {mode === "create" ? "新しいシミュレーション" : "シミュレーション名を変更"}
          </h2>
          <button type="button" onClick={onClose} disabled={saving} aria-label="閉じる" className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-surface-hover">
            <Icon name="x-lg" />
          </button>
        </div>
        <label className="mt-5 block text-sm font-semibold text-ink" htmlFor="simulation-title-input">
          名前
        </label>
        <input
          id="simulation-title-input"
          autoFocus
          type="text"
          maxLength={120}
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
          placeholder="例: 新製品についての議論"
          className="mt-2 w-full rounded-xl border border-line bg-surface-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
        <div className="mt-1 flex justify-between text-[11px] text-ink-faint">
          <span>{error}</span>
          <span>{title.length} / 120</span>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-full border border-line px-4 py-2 text-sm text-ink-muted hover:bg-surface-hover">
            閉じる
          </button>
          <button type="submit" disabled={!normalized || saving} className="rounded-full bg-accent-strong px-4 py-2 text-sm font-semibold text-white hover:bg-accent disabled:opacity-50">
            {saving ? "保存中…" : mode === "create" ? "開始" : "保存"}
          </button>
        </div>
      </form>
    </div>
  );
}
