import { useRef, useState } from "react";
import type { RoomVisibility } from "@brickr/shared";

import { Dialog } from "../../components/Dialog";
import { toErrorMessage } from "../../services/api-client";

export type CreateRoomDialogProps = {
  onClose: () => void;
  onSave: (title: string, visibility: RoomVisibility) => Promise<void>;
};

/** Human-readable label and description for each visibility level. */
const VISIBILITY_OPTIONS: {
  value: RoomVisibility;
  label: string;
  description: string;
}[] = [
  {
    value: "public",
    label: "パブリック",
    description: "誰でも参加・投稿できます",
  },
  {
    value: "open",
    label: "オープン",
    description: "誰でも閲覧できますが、投稿には参加申請が必要です",
  },
  {
    value: "closed",
    label: "クローズド",
    description: "メンバーのみ閲覧・投稿できます。参加申請が必要です",
  },
  {
    value: "private",
    label: "プライベート",
    description: "招待されたメンバーのみ参加できます",
  },
];

/**
 * Room creation dialog with visibility selection (issue #178).
 *
 * Extends the basic room name dialog with a visibility radio group so the
 * creator can choose the room's access policy at creation time. Visibility
 * is immutable after creation, so this is the only place to set it.
 */
export function CreateRoomDialog({ onClose, onSave }: CreateRoomDialogProps) {
  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState<RoomVisibility>("public");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const normalized = title.trim();

  const submit = (): void => {
    if (!normalized || saving) return;
    setSaving(true);
    setError(null);
    void onSave(normalized, visibility)
      .then(onClose)
      .catch((cause: unknown) => setError(toErrorMessage(cause)))
      .finally(() => setSaving(false));
  };

  return (
    <Dialog
      titleId="create-room-dialog-title"
      title="新しいルーム"
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
        {/* Room title */}
        <label className="block text-sm font-semibold text-ink" htmlFor="create-room-title-input">
          ルーム名
        </label>
        <input
          ref={inputRef}
          id="create-room-title-input"
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

        {/* Visibility selection */}
        <fieldset className="mt-5">
          <legend className="text-sm font-semibold text-ink">公開設定</legend>
          <div className="mt-2 space-y-2">
            {VISIBILITY_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition ${
                  visibility === option.value
                    ? "border-accent bg-accent/5"
                    : "border-line hover:bg-surface-hover"
                }`}
              >
                <input
                  type="radio"
                  name="visibility"
                  value={option.value}
                  checked={visibility === option.value}
                  onChange={() => setVisibility(option.value)}
                  className="mt-0.5 shrink-0 accent-accent"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{option.label}</p>
                  <p className="text-xs text-ink-faint">{option.description}</p>
                </div>
              </label>
            ))}
          </div>
        </fieldset>

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
            {saving ? "作成中…" : "作成"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
