import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GLOBAL_SIMULATION_ID, type FeedFilter, type FeedThreadDto } from "@brickr/shared";

import { ErrorBanner } from "../../components/ErrorBanner";
import { Spinner } from "../../components/Spinner";
import { useAuth } from "../auth/AuthContext";
import { Composer } from "../composer/Composer";
import { PostCard } from "../timeline/PostCard";
import { useUserProfile } from "../../hooks/useUserProfile";
import { postPath, roomPath } from "../../routes";
import { readFeedFilter, writeFeedFilter } from "../rooms/feed-filter-storage";
import { useFeed } from "./useFeed";

/** Stable module-level reference for the global feed scope. */
const GLOBAL_FEED_SCOPE = { kind: "global" } as const;

/**
 * The unified feed (§5.1, §5.2, §16.1, §16.4).
 *
 * Uses `useFeed` for SSE-driven realtime updates, cursor pagination, and the
 * `すべて／自分あて` filter (§16.1). Loading/error/empty states and the
 * reconnecting indicator are all handled here per §16.4.
 */
export function FeedScreen() {
  const { user } = useAuth();
  const userProfile = useUserProfile();
  const [filter, setFilter] = useState<FeedFilter>(readFeedFilter);

  const feed = useFeed(GLOBAL_FEED_SCOPE, filter);

  const handleFilterChange = (next: FeedFilter) => {
    writeFeedFilter(next);
    setFilter(next);
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      {/* Header (§16.1) */}
      <header className="border-b border-line px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-lg font-bold text-ink">フィード</h1>
            <p className="text-xs text-ink-faint">すべてのルームの投稿</p>
          </div>
          {/* Anonymous generation indicator (§16.1) */}
          {feed.activeResponseCount > 0 ? (
            <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface-raised px-2.5 py-1 text-[11px] text-ink-muted">
              <Spinner size="sm" />
              応答を生成中
            </span>
          ) : null}
        </div>

        {/* すべて／自分あて filter (§16.1) — hidden for unauthenticated users */}
        {user ? (
          <div className="mt-2 flex gap-1">
            <FilterTab
              label="すべて"
              active={filter === "all"}
              onClick={() => handleFilterChange("all")}
            />
            <FilterTab
              label="自分あて"
              active={filter === "mine"}
              onClick={() => handleFilterChange("mine")}
            />
          </div>
        ) : null}
      </header>

      {/* SSE reconnecting indicator (§16.4) */}
      {feed.connection === "reconnecting" ? (
        <p className="flex items-center gap-2 border-b border-line px-4 py-2 text-xs text-warn">
          <Spinner size="sm" />
          リアルタイム接続が切れました。再接続中です…
        </p>
      ) : null}

      {/* Composer — logged-in users only */}
      {user ? (
        <div className="border-b border-line px-4 py-3">
          <Composer
            simulationId={GLOBAL_SIMULATION_ID}
            characters={[]}
            userProfile={userProfile.profile}
            onPosted={(post) => {
              // Build a minimal thread and insert it immediately so the user
              // sees their post before the SSE echo arrives (§9.2).
              feed.upsertThread({
                root: post,
                room: { id: GLOBAL_SIMULATION_ID, title: "フィード", isFeed: true },
                latestReplies: [],
                replyCount: 0,
                lastActivityAt: post.createdAt,
                capabilities: {
                  canOpenAuthor: true,
                  canOpenRoom: false,
                  canOpenThread: true,
                  canReply: true,
                  canQuote: true,
                  canLoadMoreReplies: false,
                },
              });
            }}
          />
        </div>
      ) : null}

      {/* Generation warning (§16.4) */}
      {feed.generationWarning ? (
        <div className="px-4 pt-3">
          <ErrorBanner
            tone="warning"
            message="一部の応答を生成できませんでした"
            onDismiss={feed.dismissGenerationWarning}
          />
        </div>
      ) : null}

      {/* Initial load error (§16.4) */}
      {feed.initialError ? (
        <div className="p-4">
          <ErrorBanner
            message="フィードを取得できませんでした"
            detail={feed.initialError}
            onRetry={feed.reload}
          />
        </div>
      ) : feed.loadingInitial ? (
        /* Initial loading spinner (§16.4) */
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : feed.threads.length === 0 ? (
        /* Empty state (§16.4) */
        <div className="px-4 py-12 text-center">
          <p className="text-sm text-ink-faint">
            {filter === "mine"
              ? "自分に関係するスレッドはまだありません"
              : "まだ投稿がありません"}
          </p>
          {filter === "all" && user ? (
            <p className="mt-2 text-xs text-ink-faint">
              上のフォームから投稿してみましょう。
            </p>
          ) : null}
        </div>
      ) : (
        /* Thread list */
        <>
          <ul>
            {feed.threads.map((thread) => (
              <li key={thread.root.id}>
                <FeedThreadRow thread={thread} currentUserId={user?.id} />
              </li>
            ))}
          </ul>

          {/* Load more (§16.4) */}
          {feed.hasMore ? (
            <div className="flex flex-col items-center gap-2 px-4 py-4">
              {feed.loadMoreError ? (
                <ErrorBanner
                  message="追加の投稿を取得できませんでした"
                  detail={feed.loadMoreError}
                  onRetry={feed.loadMore}
                />
              ) : (
                <button
                  type="button"
                  disabled={feed.loadingMore}
                  onClick={feed.loadMore}
                  className="rounded-full border border-line px-4 py-2 text-sm text-ink-muted transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {feed.loadingMore ? (
                    <span className="flex items-center gap-2">
                      <Spinner size="sm" />
                      読み込み中…
                    </span>
                  ) : (
                    "さらに読み込む"
                  )}
                </button>
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function FilterTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
        active
          ? "bg-accent/15 text-accent"
          : "text-ink-muted hover:bg-surface-hover hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

function FeedThreadRow({
  thread,
  currentUserId,
}: {
  thread: FeedThreadDto;
  currentUserId: string | undefined;
}) {
  const navigate = useNavigate();
  const onExpand = thread.capabilities.canOpenThread
    ? (postId: string) => navigate(postPath(postId))
    : undefined;

  return (
    <div>
      <div className="px-4 pt-2.5 text-xs text-ink-faint">
        {thread.capabilities.canOpenRoom ? (
          <Link to={roomPath(thread.root.simulationId)} className="hover:underline">
            {thread.room.title}
          </Link>
        ) : (
          <span>{thread.room.title}</span>
        )}
      </div>
      <PostCard
        post={thread.root}
        currentUserId={currentUserId}
        showQuotedPost
        {...(onExpand ? { onExpand } : {})}
      />
      {thread.latestReplies.map((reply) => (
        <PostCard key={reply.id} post={reply} currentUserId={currentUserId} dense />
      ))}
    </div>
  );
}
