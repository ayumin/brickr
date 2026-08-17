import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { type FeedFilter } from "@brickr/shared";

import { ErrorBanner } from "../../components/ErrorBanner";
import { Spinner } from "../../components/Spinner";
import { useAuth } from "../auth/AuthContext";
import { handlePath, postPath } from "../../routes";
import { readFeedFilter, writeFeedFilter } from "../rooms/feed-filter-storage";
import { FeedHeader } from "./FeedHeader";
import { FeedThreadList } from "./FeedThreadList";
import { useFeed } from "./useFeed";

/** Stable module-level reference for the global feed scope. */
const GLOBAL_FEED_SCOPE = { kind: "all" } as const;

/**
 * The unified feed (§5.1, §5.2, §16.1, §16.4).
 *
 * Read-only: posting and replying are only available from within a Room
 * (§168). `FeedThreadList` (shared with `RoomScreen`, §10.2) renders the
 * threads and owns the scroll-position correction (§12.4).
 */
export function FeedScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FeedFilter>(readFeedFilter);

  const feed = useFeed(GLOBAL_FEED_SCOPE, filter);

  const handleFilterChange = useCallback((next: FeedFilter) => {
    writeFeedFilter(next);
    setFilter(next);
  }, []);

  // Only an author already visible in a loaded thread can be clicked, and
  // every post already carries its own author's handle (§9.1) - no separate
  // roster fetch is needed just to resolve an id back to one.
  const authorHandleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const thread of feed.threads) {
      map.set(thread.root.author.id, thread.root.author.handle);
      for (const reply of thread.latestReplies) {
        map.set(reply.author.id, reply.author.handle);
      }
    }
    return map;
  }, [feed.threads]);

  const openAuthor = useCallback(
    (authorId: string) => {
      const handle = authorHandleById.get(authorId);
      if (handle) navigate(handlePath(handle));
    },
    [authorHandleById, navigate],
  );

  const openHandle = useCallback((handle: string) => navigate(handlePath(handle)), [navigate]);
  const openThread = useCallback((postId: string) => navigate(postPath(postId)), [navigate]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      <div className="sticky top-0 z-10 bg-canvas/95 backdrop-blur">
        <FeedHeader
          title="フィード"
          subtitle="すべてのルームの投稿"
          activeResponseCount={feed.activeResponseCount}
          showFilters={user !== null}
          filter={filter}
          onFilterChange={handleFilterChange}
        />
      </div>

      {/* SSE reconnecting indicator (§16.4) */}
      {feed.connection === "reconnecting" ? (
        <p className="flex items-center gap-2 border-b border-line px-4 py-2 text-xs text-warn">
          <Spinner size="sm" />
          リアルタイム接続が切れました。再接続中です…
        </p>
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
        </div>
      ) : (
        <>
          <FeedThreadList
            threads={feed.threads}
            {...(user ? { currentUserId: user.id } : {})}
            onOpenAuthor={openAuthor}
            onOpenHandle={openHandle}
            onOpenThread={openThread}
          />

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
