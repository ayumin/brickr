import { useState } from "react";
import type {
  SaveUserProfileRequest,
  UserProfileDto,
} from "@enjo/shared";
import { ErrorBanner } from "../../components/ErrorBanner";
import { api, toErrorMessage } from "../../services/api-client";

export function UserProfileEditor({
  profile,
  onClose,
  onSaved,
}: {
  profile: UserProfileDto;
  onClose: () => void;
  onSaved: (profile: UserProfileDto) => void;
}) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [description, setDescription] = useState(profile.description);
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    const request: SaveUserProfileRequest = {
      displayName: displayName.trim(),
      description: description.trim(),
      ...(avatarUrl.trim() ? { avatarUrl: avatarUrl.trim() } : {}),
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
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/75 p-3 backdrop-blur-sm sm:p-6">
      <form
        className="mx-auto w-full max-w-lg space-y-5 rounded-2xl border border-line bg-canvas p-5 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <header className="flex items-start gap-3">
          <div>
            <h2 className="font-bold text-ink">プロフィールを編集</h2>
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

        <label className="block text-sm text-ink-muted">
          Avatar URL（任意）
          <input
            type="url"
            value={avatarUrl}
            onChange={(event) => setAvatarUrl(event.currentTarget.value)}
            className="mt-1.5 w-full rounded-xl border border-line bg-surface-raised px-3 py-2 text-ink focus:border-accent/60 focus:outline-none"
          />
        </label>

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
