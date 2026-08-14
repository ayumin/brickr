import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GLOBAL_SIMULATION_ID, type FeedFilter, type FeedThreadDto, type PostDto } from "@brickr/shared";

import { ErrorBanner } from "../../components/ErrorBanner";
import { Spinner } from "../../components/Spinner";
import { useAuth } from "../auth/AuthContext";
import { Composer } from "../composer/Composer";
import { PostCard } from "../timeline/PostCard";
import { useUserProfile } from "../../hooks/useUserProfile";
import { api, isAbortError, toErrorMessage } from "../../services/api-client";
import { postPath, roomPath } from "../../routes";
import { readFeedFilter, writeFeedFilter } from "../rooms/feed-filter-storage";
import { FeedFilters } from "./FeedFilters";
import { useFeed } from "./useFeed";

/**
 * The unified feed (§5.1, §5.2, §12.3).
 *
 * Uses `useFeed` for SSE-driven real-time updates, cursor pagination (load
 * more), and the `すべて／自分あて` filter. The filter is hidden for
 * unauthenticated visitors — they have no "mine" concept (§10.1, §16.3).
 */
export function FeedScreen() {
  const { user } = useAuth();
  const userProfile = useUserProfile();

  const [filter, setFilter] = useState<FeedFilter>(() => readFeedFilter());

  const handleFilterChange = useCallback((next: FeedFilter) => {
    writeFeedFilter(next);
    setFilter(next);
  }, []);

  const feed = useFeed(GLOBAL_FEED_TARGET, filter);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      <header className="border-b border-line px-4 py-3">
        <h1 className="font-display text-lg font-bold text-ink">フィード</h1>
        <p className="text-xs text-ink-faint">すべてのルームの投稿</p>
      </header>

      {user ? (
        <div className="border-b border-line px-4 py-3">
          <Composer
            simulationId={GLOBAL_SIMULATION_ID}
            characters={[]}
            userProfile={userProfile.profile}
            onPosted={(post) => {
              // The Composer already called createPost and the SSE stream will
              // deliver the thread update. `upsertThread` is not available here
              // because the Composer only exposes the raw PostDto, not the full
              // CreatePostResponse. A reload is the simplest guarantee that the
              // new thread appears even if the SSE echo is delayed.
              feed.reload();
              void post;
            }}
          />
        </div>
      ) : null}

      {user ? (
        <FeedFilters active={filter} onChange={handleFilterChange} />
      ) : null}

      {feed.connection === "reconnecting" ? (
        <p className="flex items-center gap-2 border-b border-line px-4 py-2 text-xs text-warn">
          <Spinner size="sm" />
          リアルタイム接続が切れました。再接続中です…
        </p>
      ) : null}

      {feed.generationWarning ? (
        <div className="px-4 pt-3">
          <ErrorBanner
            tone="warning"
            message="一部の応答を生成できませんでした"
            onDismiss={feed.dismissGenerationWarning}
          />
        </div>
      ) : null}

      {feed.loadingInitial ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : feed.initialError ? (
        <div className="p-4">
          <ErrorBanner
            message="フィードを取得できませんでした"
            detail={feed.initialError}
            onRetry={feed.reload}
          />
        </div>
      ) : feed.threads.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-ink-faint">
          まだ投稿がありません
        </p>
      ) : (
        <>
          <ul>
            {feed.threads.map((thread) => (
              <li key={thread.root.id}>
                <FeedThreadRow thread={thread} currentUserId={user?.id} />
              </li>
            ))}
          </ul>

          {/* Load more */}
          {feed.hasMore || feed.loadingMore || feed.loadMoreError ? (
            <div className="border-t border-line px-4 py-4">
              {feed.loadMoreError ? (
                <ErrorBanner
                  message="追加の投稿を取得できませんでした"
                  detail={feed.loadMoreError}
                  onRetry={feed.loadMore}
                />
              ) : feed.loadingMore ? (
                <div className="flex justify-center">
                  <Spinner size="md" />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={feed.loadMore}
                  className="w-full rounded-full border border-line py-2 text-sm font-medium text-ink-muted transition hover:bg-surface-hover/60 hover:text-ink"
                >
                  さらに読み込む
                </button>
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

type RepliesState =
  | { status: "collapsed" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "expanded"; posts: PostDto[] };

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

  const hiddenReplyCount = thread.replyCount - thread.latestReplies.length;
  const canLoadMore = thread.capabilities.canLoadMoreReplies && hiddenReplyCount > 0;

  const [repliesState, setRepliesState] = useState<RepliesState>({ status: "collapsed" });

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const loadAllReplies = useCallback(() => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setRepliesState({ status: "loading" });
    api
      .getThreadReplies(thread.root.id, controller.signal)
      .then((posts) => setRepliesState({ status: "expanded", posts }))
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return;
        setRepliesState({ status: "error", message: toErrorMessage(cause) });
      });
  }, [thread.root.id]);

  const visibleReplies =
    repliesState.status === "expanded" ? repliesState.posts : thread.latestReplies;

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
      {visibleReplies.map((reply) => (
        <PostCard key={reply.id} post={reply} currentUserId={currentUserId} dense />
      ))}

      {/* 残りN件を表示 */}
      {canLoadMore && repliesState.status === "collapsed" ? (
        <button
          type="button"
          onClick={loadAllReplies}
          className="w-full border-b border-line px-4 py-2 text-left text-xs text-accent transition hover:bg-surface-hover/60"
        >
          残り{hiddenReplyCount}件を表示
        </button>
      ) : repliesState.status === "loading" ? (
        <div className="flex justify-center border-b border-line py-2">
          <Spinner size="sm" />
        </div>
      ) : repliesState.status === "error" ? (
        <div className="border-b border-line px-4 py-2">
          <ErrorBanner
            message="返信を取得できませんでした"
            detail={repliesState.message}
            onRetry={loadAllReplies}
          />
        </div>
      ) : null}
    </div>
  );
}
