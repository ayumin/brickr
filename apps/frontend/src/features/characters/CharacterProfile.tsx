import { Avatar } from "../../components/Avatar";

export type CharacterProfileProps = {
  displayName: string;
  handle: string;
  avatarUrl?: string | null;
  /** Characters have one; the human user does not. */
  description?: string | null;
  /** Number of posts this author has in the current simulation. */
  postCount: number;
  /** Go back home with this handle pre-filled in the composer. */
  onMention?: (handle: string) => void;
  onEdit?: () => void;
};

/**
 * Profile header shown at the top of an author's timeline.
 * Only public profile data is displayed here. Persona prompts are loaded by
 * the separate editor when requested.
 */
export function CharacterProfile({
  displayName,
  handle,
  avatarUrl,
  description,
  postCount,
  onMention,
  onEdit,
}: CharacterProfileProps) {
  return (
    <section className="border-b border-line">
      <div className="h-20 bg-gradient-to-r from-accent-soft via-surface-hover to-surface-raised" />

      <div className="px-4 pb-4">
        <div className="-mt-8 flex items-end justify-between gap-3">
          <div className="rounded-full ring-4 ring-canvas">
            <Avatar
              handle={handle}
              displayName={displayName}
              avatarUrl={avatarUrl}
              size="lg"
            />
          </div>

          <div className="mb-1 flex gap-2">
            {onEdit ? (
              <button
                type="button"
                onClick={onEdit}
                className="rounded-full border border-line px-3 py-1.5 text-xs text-ink-muted hover:text-ink"
              >
                設定を編集
              </button>
            ) : null}
            {onMention ? (
              <button
                type="button"
                onClick={() => {
                  onMention(handle);
                }}
                className="rounded-full bg-accent-strong px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-accent"
              >
                @で話しかける
              </button>
            ) : null}
          </div>
        </div>

        <h2 className="mt-3 text-lg font-bold break-words text-ink">
          {displayName}
        </h2>
        <p className="text-sm text-ink-faint">@{handle}</p>

        {description ? (
          <p className="mt-3 text-sm leading-relaxed break-words whitespace-pre-wrap text-ink-muted">
            {description}
          </p>
        ) : null}

        <p className="mt-3 text-xs text-ink-faint">
          このシミュレーションでの投稿数{" "}
          <span className="font-semibold text-ink-muted">
            {postCount}
          </span>
        </p>
      </div>
    </section>
  );
}
