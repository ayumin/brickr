import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GLOBAL_SIMULATION_ID, type FeedPageDto, type FeedThreadDto } from "@brickr/shared";

import { ErrorBanner } from "../../components/ErrorBanner";
import { Spinner } from "../../components/Spinner";
import { useAuth } from "../auth/AuthContext";
import { Composer } from "../composer/Composer";
import { PostCard } from "../timeline/PostCard";
import { useUserProfile } from "../../hooks/useUserProfile";
import { api, isAbortError, toErrorMessage } from "../../services/api-client";
import { postPath, roomPath } from "../../routes";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; page: FeedPageDto };

/**
 * The unified feed (§5.1, §5.2). Fetches page one of `/api/feed` once and
 * renders it - no realtime updates, no cursor pagination, and the
 * `すべて／自分あて` filter is fixed to `all` and hidden. All three are Step
 * 7's job (feed reducer, SSE-driven upserts, load more); this screen only
 * needs to exist so `/` is a real, working destination instead of always
 * "the last room" (§13.3).
 */
export function FeedScreen() {
  const { user } = useAuth();
  const userProfile = useUserProfile();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    api
      .getFeed("all", controller.signal)
      .then((page) => setState({ status: "ready", page }))
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return;
        setState({ status: "error", message: toErrorMessage(cause) });
      });
    return () => controller.abort();
  }, [reloadToken]);

  const retry = () => setReloadToken((value) => value + 1);

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
            onPosted={retry}
          />
        </div>
      ) : null}

      {state.status === "loading" ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : state.status === "error" ? (
        <div className="p-4">
          <ErrorBanner
            message="フィードを取得できませんでした"
            detail={state.message}
            onRetry={retry}
          />
        </div>
      ) : state.page.threads.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-ink-faint">
          まだ投稿がありません
        </p>
      ) : (
        <ul>
          {state.page.threads.map((thread) => (
            <li key={thread.root.id}>
              <FeedThreadRow thread={thread} currentUserId={user?.id} />
            </li>
          ))}
        </ul>
      )}
    </div>
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
