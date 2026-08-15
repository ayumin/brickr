import { useState } from "react";
import type { SaveUserProfileRequest, UserProfileDto } from "@brickr/shared";

import { AvatarUploader } from "../../components/AvatarUploader";
import { ErrorBanner } from "../../components/ErrorBanner";
import { api, toErrorMessage } from "../../services/api-client";

/** `/settings/profile` (§22): display name, description, avatar. `@handle` never changes. */
export function ProfileSettings({
  profile,
  onSaved,
}: {
  profile: UserProfileDto;
  onSaved: (profile: UserProfileDto) => void;
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
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {error ? (
        <ErrorBanner message="プロフィールを保存できませんでした" detail={error} onDismiss={() => setError(null)} />
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
      <p className="text-xs text-ink-faint">@{profile.handle} は変更できません</p>
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
      <div className="flex justify-end border-t border-line pt-4">
        <button
          type="submit"
          disabled={saving || displayName.trim().length === 0}
          className="rounded-full bg-accent-strong px-5 py-2 text-sm font-semibold text-white hover:bg-accent disabled:opacity-50"
        >
          {saving ? "保存中…" : "変更を保存"}
        </button>
      </div>
    </form>
  );
}
