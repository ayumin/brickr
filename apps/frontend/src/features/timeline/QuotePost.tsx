import type { QuotedPostDto } from "@enjo/shared";

import { Avatar } from "../../components/Avatar";

/**
 * Tiny relative-time formatter (no date library, CLAUDE.md keeps deps small).
 * Lives here because `PostCard` already imports this module, which keeps the
 * dependency one-directional.
 */
export function formatRelativeTime(
  isoDate: string,
  now: number = Date.now(),
): string {
  const timestamp = new Date(isoDate).getTime();
  if (Number.isNaN(timestamp)) {
    return "";
  }

  const seconds = Math.floor((now - timestamp) / 1000);

  if (seconds < 5) {
    return "たった今";
  }
  if (seconds < 60) {
    return `${String(seconds)}秒前`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${String(minutes)}分前`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${String(hours)}時間前`;
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${String(days)}日前`;
  }

  const date = new Date(timestamp);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const sameYear = date.getFullYear() === new Date(now).getFullYear();

  return sameYear
    ? `${String(month)}月${String(day)}日`
    : `${String(date.getFullYear())}年${String(month)}月${String(day)}日`;
}

/** Full timestamp for the `title` tooltip. */
export function formatAbsoluteTime(isoDate: string): string {
  const timestamp = new Date(isoDate).getTime();
  if (Number.isNaN(timestamp)) {
    return "";
  }
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${String(date.getFullYear())}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export type QuotePostProps = {
  post: QuotedPostDto;
  /** Open the quoted author's timeline. */
  onOpenAuthor?: (authorId: string) => void;
};

/** Embedded card for the post a character quoted / reposted (CLAUDE.md §38). */
export function QuotePost({ post, onOpenAuthor }: QuotePostProps) {
  const author = post.author;

  return (
    <article className="mt-3 rounded-xl border border-line bg-surface-raised px-3 py-2.5 transition hover:border-line-strong">
      <header className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={
            onOpenAuthor
              ? () => {
                  onOpenAuthor(author.id);
                }
              : undefined
          }
          disabled={!onOpenAuthor}
          className="flex min-w-0 items-center gap-2 rounded-full text-left disabled:cursor-default"
          aria-label={`${author.displayName} のタイムライン`}
        >
          <Avatar
            handle={author.handle}
            displayName={author.displayName}
            avatarUrl={author.avatarUrl}
            size="xs"
          />
          <span className="truncate text-[13px] font-semibold text-ink">
            {author.displayName}
          </span>
          <span className="truncate text-[13px] text-ink-faint">
            @{author.handle}
          </span>
        </button>
        <span className="text-ink-faint">·</span>
        <time
          dateTime={post.createdAt}
          title={formatAbsoluteTime(post.createdAt)}
          className="shrink-0 text-[13px] text-ink-faint"
        >
          {formatRelativeTime(post.createdAt)}
        </time>
      </header>

      <p className="mt-1 text-[14px] break-words whitespace-pre-wrap text-ink-muted">
        {post.content}
      </p>
    </article>
  );
}
