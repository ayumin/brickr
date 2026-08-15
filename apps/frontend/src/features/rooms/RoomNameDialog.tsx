import { useRef, useState } from "react";

import { Dialog } from "../../components/Dialog";
import { toErrorMessage } from "../../services/api-client";

export type RoomNameDialogProps = {
  mode: "create" | "rename";
  initialValue?: string;
  onClose: () => void;
  onSave: (title: string) => Promise<void>;
};

/**
 * The room create/rename dialog (§19.1, §19.2) — the `SimulationNameDialog`
 * successor, migrated onto the shared `Dialog` shell for focus trap/Escape
 * (Issue #50/#51) and renamed to speak "ルーム" rather than "シミュレーション"
 * (CLAUDE.md's UI-facing naming rule; the internal `Simulation` domain name
 * is unaffected).
 *
 * Room creation is name-only by design (§19.1): the prototype's topic/cast/
 * temperature fields are all unimplemented in phase 1, and an input nobody's
 * setting has any effect on would be exactly the "見せかけの設定" CLAUDE.md's
 * ground rules ban.
 */
export function RoomNameDialog({ mode, initialValue = "", onClose, onSave }: RoomNameDialogProps) {
  const [title, setTitle] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const normalized = title.trim();

  const submit = (): void => {
    if (!normalized || saving) return;
    setSaving(true);
    setError(null);
    void onSave(normalized)
      .then(onClose)
      .catch((cause: unknown) => setError(toErrorMessage(cause)))
      .finally(() => setSaving(false));
  };

  return (
    <Dialog
      titleId="room-name-dialog-title"
      title={mode === "create" ? "新しいルーム" : "ルーム名を変更"}
      onClose={onClose}
      closeDisabled={saving}
      initialFocusRef={inputRef}
    >
      <form
        className="p-5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="block text-sm font-semibold text-ink" htmlFor="room-title-input">
          ルーム名
        </label>
        <input
          ref={inputRef}
          id="room-title-input"
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
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-full border border-line px-4 py-2 text-sm text-ink-muted hover:bg-surface-hover"
          >
            閉じる
          </button>
          <button
            type="submit"
            disabled={!normalized || saving}
            className="rounded-full bg-accent-strong px-4 py-2 text-sm font-semibold text-white hover:bg-accent disabled:opacity-50"
          >
            {saving ? "保存中…" : mode === "create" ? "作成" : "保存"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
