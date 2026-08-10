import type { ReactNode } from "react";
import type { PostDto } from "@enjo/shared";

import { Avatar } from "../../components/Avatar";
import { QuotePost, formatAbsoluteTime, formatRelativeTime } from "./QuotePost";
import { PostImage } from "./PostImage";

/** Handles are ASCII (see character seeds), so this stays deliberately narrow. */
const MENTION_PATTERN = /@([A-Za-z0-9_]{1,32})/g;

/**
 * Renders post text with `@handle` highlighted.
 *
 * This splits the string and returns React elements. User input is NEVER
 * injected as HTML — no `dangerouslySetInnerHTML` anywhere (CLAUDE.md §55).
 */
function renderContent(
  content: string,
  knownHandles: ReadonlySet<string> | undefined,
  onOpenHandle: ((handle: string) => void) | undefined,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;

  MENTION_PATTERN.lastIndex = 0;

  for (const match of content.matchAll(MENTION_PATTERN)) {
    const handle = match[1];
    const start = match.index ?? -1;
    if (handle === undefined || start < 0) {
      continue;
    }

    if (start > cursor) {
      nodes.push(content.slice(cursor, start));
    }

    const isKnown = knownHandles ? knownHandles.has(handle) : true;
    const key = `mention-${String(start)}-${handle}`;

    if (isKnown && onOpenHandle) {
      nodes.push(
        <button
          key={key}
          type="button"
          onClick={() => {
            onOpenHandle(handle);
          }}
          className="cursor-pointer rounded text-accent transition hover:underline"
        >
          @{handle}
        </button>,
      );
    } else if (isKnown) {
      nodes.push(
        <span key={key} className="text-accent">
          @{handle}
        </span>,
      );
    } else {
      nodes.push(
        <span key={key} className="text-ink-muted">
          @{handle}
        </span>,
      );
    }

    cursor = start + match[0].length;
  }

  if (cursor < content.length) {
    nodes.push(content.slice(cursor));
  }

  return nodes;
}

export type PostCardProps = {
  post: PostDto;
  /** Handle of the post this one replies to, when we have it loaded. */
  replyToHandle?: string | null;
  /** Handles we recognise (characters + the user), for mention highlighting. */
  knownHandles?: ReadonlySet<string>;
  /** Open an author's timeline (avatar / name / handle clicks). */
  onOpenAuthor?: (authorId: string) => void;
  /** Open a timeline from an `@handle` inside the body. */
  onOpenHandle?: (handle: string) => void;
  /** Transitive reply count (all descendants). */
  replyCount?: number;
  /** Direct repost (quote) count. */
  repostCount?: number;
  repliesExpanded?: boolean;
  repostsExpanded?: boolean;
  /** Omit to render the reply count as a plain, non-interactive number. */
  onToggleReplies?: () => void;
  /** Omit to hide the repost expander even when the count is above zero. */
  onToggleReposts?: () => void;
  onReply?: () => void;
  onRepost?: () => void;
  /** Compact rendering, used for replies inside an expanded thread. */
  dense?: boolean;
};

export function PostCard({
  post,
  replyToHandle,
  knownHandles,
  onOpenAuthor,
  onOpenHandle,
  replyCount = 0,
  repostCount = 0,
  repliesExpanded = false,
  repostsExpanded = false,
  onToggleReplies,
  onToggleReposts,
  onReply,
  onRepost,
  dense = false,
}: PostCardProps) {
  const isUser = post.author.kind === "user";
  const isRepost = post.quoteOf !== null;
  const openAuthor = onOpenAuthor
    ? () => {
        onOpenAuthor(post.author.id);
      }
    : undefined;

  return (
    <article
      className={`enjo-post-in flex gap-3 border-b border-line transition-colors ${
        dense ? "px-4 py-2.5" : "px-4 py-3.5"
      } ${isUser ? "bg-accent-soft/50" : "hover:bg-surface-hover/60"}`}
    >
      <button
        type="button"
        onClick={openAuthor}
        disabled={!openAuthor}
        className="mt-0.5 shrink-0 rounded-full disabled:cursor-default"
        aria-label={`${post.author.displayName} のタイムライン`}
      >
        <Avatar
          handle={post.author.handle}
          displayName={post.author.displayName}
          avatarUrl={post.author.avatarUrl}
          size={dense ? "sm" : "md"}
        />
      </button>

      <div className="min-w-0 flex-1">
        {isRepost ? (
          <p className="mb-1 text-xs text-ink-faint">
            <span aria-hidden="true">🔁 </span>
            リポスト（引用）
          </p>
        ) : null}

        {post.replyTo ? (
          <p className="mb-1 text-xs text-ink-faint">
            {replyToHandle ? (
              <>
                <span className="text-accent/80">@{replyToHandle}</span> への返信
              </>
            ) : (
              "スレッドへの返信"
            )}
          </p>
        ) : null}

        <header className="flex min-w-0 flex-wrap items-center gap-x-1.5">
          <button
            type="button"
            onClick={openAuthor}
            disabled={!openAuthor}
            className="flex min-w-0 items-center gap-x-1.5 rounded text-left transition disabled:cursor-default enabled:hover:underline"
          >
            <span className="truncate font-semibold text-ink">
              {post.author.displayName}
            </span>
            <span className="truncate text-sm text-ink-faint">
              @{post.author.handle}
            </span>
          </button>
          {isUser ? (
            <span className="rounded-full bg-accent/20 px-1.5 py-px text-[10px] font-medium text-accent">
              あなた
            </span>
          ) : null}
          <span className="text-ink-faint">·</span>
          <time
            dateTime={post.createdAt}
            title={formatAbsoluteTime(post.createdAt)}
            className="shrink-0 text-sm text-ink-faint"
          >
            {formatRelativeTime(post.createdAt)}
          </time>
        </header>

        <p
          className={`mt-0.5 break-words whitespace-pre-wrap leading-relaxed text-ink ${
            dense ? "text-[14px]" : "text-[15px]"
          }`}
        >
          {renderContent(post.content, knownHandles, onOpenHandle)}
        </p>

        {post.imageUrl ? <PostImage src={post.imageUrl} /> : null}

        {post.quotedPost ? (
          <QuotePost
            post={post.quotedPost}
            {...(onOpenAuthor ? { onOpenAuthor } : {})}
          />
        ) : null}

        {/* Metadata + actions: reply count / repost count / reply / repost. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-ink-faint">
          {onToggleReplies && replyCount > 0 ? (
            <button
              type="button"
              onClick={onToggleReplies}
              aria-expanded={repliesExpanded}
              className="rounded-full px-2 py-1 font-medium text-accent transition hover:bg-accent/10"
            >
              {repliesExpanded
                ? `返信を隠す (${String(replyCount)})`
                : `返信を表示 (${String(replyCount)})`}
            </button>
          ) : (
            <span className="px-2 py-1">返信 {replyCount}</span>
          )}

          {onToggleReposts && repostCount > 0 ? (
            <button
              type="button"
              onClick={onToggleReposts}
              aria-expanded={repostsExpanded}
              className="rounded-full px-2 py-1 font-medium text-accent transition hover:bg-accent/10"
            >
              {repostsExpanded
                ? `リポストを隠す (${String(repostCount)})`
                : `リポスト (${String(repostCount)})`}
            </button>
          ) : null}

          <span className="grow" />

          {onReply ? (
            <button
              type="button"
              onClick={onReply}
              className="rounded-full px-2 py-1 transition hover:bg-accent/10 hover:text-accent"
            >
              返信
            </button>
          ) : null}
          {onRepost ? (
            <button
              type="button"
              onClick={onRepost}
              className="rounded-full px-2 py-1 transition hover:bg-accent/10 hover:text-accent"
            >
              リポスト
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
