import { useState } from "react";
import type {
  SaveUserProfileRequest,
  UserProfileDto,
} from "@enjo/shared";
import { ErrorBanner } from "../../components/ErrorBanner";
import { AvatarUploader } from "../../components/AvatarUploader";
import { api, toErrorMessage } from "../../services/api-client";
import { THEME_OPTIONS, type Theme } from "../../services/theme";

export function UserProfileEditor({
  profile,
  onClose,
  onSaved,
  theme,
  onThemeChange,
}: {
  profile: UserProfileDto;
  onClose: () => void;
  onSaved: (profile: UserProfileDto) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [description, setDescription] = useState(profile.description);
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(profile.avatarUrl);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    const request: SaveUserProfileRequest = {
      displayName: displayName.trim(),
      description: description.trim(),
      ...(avatarUrl ? { avatarUrl } : {}),
    };
    try {
      onSaved(await api.updateUserProfile(request));
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/75 p-3 backdrop-blur-sm sm:p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-profile-editor-title"
        className="mx-auto w-full max-w-lg space-y-5 rounded-2xl border border-line bg-canvas p-5 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <header className="flex items-start gap-3">
          <div>
            <h2 id="user-profile-editor-title" className="font-bold text-ink">
              プロフィールを編集
            </h2>
            <p className="text-xs text-ink-faint">@{profile.handle} は変更できません</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-full border border-line px-3 py-1 text-xs text-ink-muted hover:text-ink"
          >
            閉じる
          </button>
        </header>

        {error ? (
          <ErrorBanner
            message="プロフィールを保存できませんでした"
            detail={error}
            onDismiss={() => setError(null)}
          />
        ) : null}

        <label className="block text-sm text-ink-muted">
          表示名
          <input
            value={displayName}
            required
            maxLength={80}
            onChange={(event) => setDisplayName(event.currentTarget.value)}
            className="mt-1.5 w-full rounded-xl border border-line bg-surface-raised px-3 py-2 text-ink focus:border-accent/60 focus:outline-none"
          />
        </label>

        <fieldset className="border-t border-line pt-4">
          <legend className="text-sm font-medium text-ink-muted">表示テーマ</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => onThemeChange(option.id)}
                aria-pressed={theme === option.id}
                className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                  theme === option.id
                    ? "border-accent bg-accent/10 font-semibold text-accent"
                    : "border-line text-ink-muted hover:border-line-strong hover:text-ink"
                }`}
              >
                <span className="mb-1.5 flex overflow-hidden rounded-full border border-black/10" aria-hidden="true">
                  {option.swatches.map((color) => (
                    <span
                      key={color}
                      className="h-3 flex-1"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </span>
                <span className="block truncate text-xs">{option.label}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <label className="block text-sm text-ink-muted">
          プロフィール
          <textarea
            value={description}
            maxLength={500}
            rows={5}
            onChange={(event) => setDescription(event.currentTarget.value)}
            className="mt-1.5 w-full resize-y rounded-xl border border-line bg-surface-raised px-3 py-2 text-ink focus:border-accent/60 focus:outline-none"
          />
        </label>

        <AvatarUploader value={avatarUrl} onChange={setAvatarUrl} />

        <div className="flex justify-end gap-3 border-t border-line pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-line px-4 py-2 text-sm text-ink-muted hover:text-ink"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-accent-strong px-5 py-2 text-sm font-semibold text-white hover:bg-accent disabled:opacity-50"
          >
            {saving ? "保存中…" : "変更を保存"}
          </button>
        </div>
      </form>
    </div>
  );
}
