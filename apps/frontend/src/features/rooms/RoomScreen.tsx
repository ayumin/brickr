import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { FeedFilter, PostDto } from "@brickr/shared";

import { Avatar } from "../../components/Avatar";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Spinner } from "../../components/Spinner";
import { handlePath, postPath, roomAnalysisPath } from "../../routes";
import { composerContextForQuote, composerContextForReply } from "../composer/composer-utils";
import { useComposeController } from "../composer/ComposeContext";
import { useUserProfile } from "../../hooks/useUserProfile";
import { FeedThreadList } from "../feed/FeedThreadList";
import { useFeed, type FeedScope } from "../feed/useFeed";
import { readFeedFilter, writeFeedFilter } from "./feed-filter-storage";
import { RoomHeader } from "./RoomHeader";
import { RoomInfoPanel } from "./RoomInfoPanel";
import { RoomInfoSheet } from "./RoomInfoSheet";
import { RoomNameDialog } from "./RoomNameDialog";
import { useSelectedRoom } from "./useSelectedRoom";

/**
 * One room's persistent content (§13.5): mounted once per opened room id by
 * AppShell and kept alive (via `hidden`, not unmount) while another screen is
 * showing, so its SSE subscription and loaded threads survive navigating away
 * and back.
 *
 * Renders through the same `FeedThreadList`/`FeedThreadCard` as the unified
 * feed, scoped to this room via `useFeed({ kind: "room", roomId }, filter)`
 * (§10.2: "並び・ページング・返信プレビューは統合フィードと同じ") - not the
 * old flat `Timeline`/`useSimulationEvents` pair, which fetched every post in
 * the room up front instead of paging through the feed API.
 */
export function RoomScreen({ roomId }: { roomId: string }) {
  const navigate = useNavigate();
  const composeController = useComposeController();
  const selectedRoom = useSelectedRoom(roomId);

  const userProfile = useUserProfile();

  const [filter, setFilter] = useState<FeedFilter>(readFeedFilter);
  const handleFilterChange = useCallback((next: FeedFilter) => {
    writeFeedFilter(next);
    setFilter(next);
  }, []);

  const [streamEnabled, setStreamEnabled] = useState(true);
  const scope = useMemo<FeedScope>(() => ({ kind: "room", roomId }), [roomId]);
  const feed = useFeed(scope, filter, streamEnabled);

  const [infoSheetOpen, setInfoSheetOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);

  // Every author clickable from this room is either the signed-in user or
  // someone whose post is already loaded - each of which already carries its
  // own handle, so no extra lookup request is needed. This includes a quoted
  // post's author (QuotePost.tsx's header): `quotedPost` is denormalised onto
  // the quoting post itself (PostDto.quotedPost), so it never needs the
  // quoted author to have their own thread root or preview reply on this page.
  const authorHandleById = useMemo(() => {
    const map = new Map<string, string>([[userProfile.profile.id, userProfile.profile.handle]]);
    for (const thread of feed.threads) {
      map.set(thread.root.author.id, thread.root.author.handle);
      if (thread.root.quotedPost) {
        map.set(thread.root.quotedPost.author.id, thread.root.quotedPost.author.handle);
      }
      for (const reply of thread.latestReplies) {
        map.set(reply.author.id, reply.author.handle);
        if (reply.quotedPost) {
          map.set(reply.quotedPost.author.id, reply.quotedPost.author.handle);
        }
      }
    }
    return map;
  }, [feed.threads, userProfile.profile.id, userProfile.profile.handle]);

  const openAuthor = useCallback(
    (authorId: string) => {
      const handle = authorHandleById.get(authorId);
      if (handle) navigate(handlePath(handle));
    },
    [authorHandleById, navigate],
  );

  const openHandle = useCallback((handle: string) => navigate(handlePath(handle)), [navigate]);
  const openThread = useCallback((postId: string) => navigate(postPath(postId)), [navigate]);

  const openReply = useCallback(
    (post: PostDto) => {
      composeController.request({
        context: composerContextForReply(post),
        onPosted: (_post, thread) => feed.upsertThread(thread),
      });
    },
    [composeController, feed],
  );

  const openQuote = useCallback(
    (post: PostDto) => {
      composeController.request({
        context: composerContextForQuote(post),
        onPosted: (_post, thread) => feed.upsertThread(thread),
      });
    },
    [composeController, feed],
  );

  if (selectedRoom.state.status === "loading" || selectedRoom.state.status === "denied") {
    return (
      <div className="flex items-center justify-center px-4 py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  if (selectedRoom.state.status === "error") {
    return (
      <div className="px-4 py-12">
        <ErrorBanner
          message="ルームを取得できませんでした"
          detail={selectedRoom.state.message}
          onRetry={selectedRoom.reload}
        />
      </div>
    );
  }

  const { simulation } = selectedRoom.state;
  const isStopped = simulation.status === "stopped";
  const roomInfoProps = {
    simulation,
    onOpenAnalysis: () => navigate(roomAnalysisPath(simulation.id)),
    // Closes the mobile info sheet too: opened from there, `RoomNameDialog`
    // would otherwise stack on top of it — two `Dialog`s mounted at once,
    // each with its own Escape handler racing the other's.
    onRename: () => {
      setInfoSheetOpen(false);
      setRenameDialogOpen(true);
    },
    onStop: selectedRoom.stop,
    onResume: selectedRoom.resume,
  };

  return (
    <div className="flex w-full">
      <div className="mx-auto flex w-full min-w-0 max-w-2xl flex-1 flex-col">
        {/* Sticks to the viewport top through the compose trigger; only the
            thread list beneath scrolls. */}
        <div className="sticky top-0 z-10 bg-canvas/95 backdrop-blur">
          <RoomHeader
            title={simulation.title ?? "無題のルーム"}
            isStopped={isStopped}
            activeResponseCount={feed.activeResponseCount}
            connection={feed.connection}
            onToggleConnection={() => setStreamEnabled((enabled) => !enabled)}
            filter={filter}
            onFilterChange={handleFilterChange}
            onOpenInfo={() => setInfoSheetOpen(true)}
          />

          {/* Compose trigger (§17, §19.3): hidden entirely when stopped, the same
              as reply/quote (already capabilities-driven) - not merely disabled,
              since a stopped room accepts no writes from anyone. */}
          {!isStopped ? (
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <Avatar
                handle={userProfile.profile.handle}
                displayName={userProfile.profile.displayName}
                avatarUrl={userProfile.profile.avatarUrl}
                size="md"
              />
              <button
                type="button"
                onClick={() => {
                  composeController.request({
                    context: {
                      mode: "new",
                      simulationId: simulation.id,
                      roomLabel: simulation.title ?? "無題のルーム",
                    },
                    onPosted: (_post, thread) => feed.upsertThread(thread),
                  });
                }}
                className="min-w-0 flex-1 rounded-full border border-line bg-surface px-4 py-2.5 text-left text-sm text-ink-faint transition hover:border-accent/50"
              >
                {"いま何が起きてる？　@ でキャストを指名"}
              </button>
            </div>
          ) : null}
        </div>

        {userProfile.error ? (
          <div className="px-4 pt-3">
            <ErrorBanner
              message="ユーザープロフィールを取得できませんでした"
              detail={userProfile.error}
              onRetry={userProfile.reload}
            />
          </div>
        ) : null}

        {feed.generationWarning ? (
          <div className="px-4 pt-3">
            {/* Aggregated on purpose (§11.2): naming who failed, or why, would
                describe the machinery behind a post. Details stay in the log. */}
            <ErrorBanner
              tone="warning"
              message="一部の応答を生成できませんでした"
              onDismiss={feed.dismissGenerationWarning}
            />
          </div>
        ) : null}

        {feed.connection === "reconnecting" ? (
          <p className="flex items-center gap-2 border-b border-line px-4 py-2 text-xs text-warn">
            <Spinner size="sm" />
            リアルタイム接続が切れました。再接続中です…
          </p>
        ) : null}

        {feed.initialError ? (
          <div className="p-4">
            <ErrorBanner
              message="ルームのフィードを取得できませんでした"
              detail={feed.initialError}
              onRetry={feed.reload}
            />
          </div>
        ) : feed.loadingInitial ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : feed.threads.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-ink-faint">
              {filter === "mine" ? "自分に関係するスレッドはまだありません" : "まだ投稿がありません"}
            </p>
            {filter === "all" && !isStopped ? (
              <p className="mt-2 text-xs text-ink-faint">
                上のフォームから投稿すると、このルームのスレッドがここに並びます。
              </p>
            ) : null}
          </div>
        ) : (
          <>
            <FeedThreadList
              threads={feed.threads}
              currentUserId={userProfile.profile.id}
              onOpenAuthor={openAuthor}
              onOpenHandle={openHandle}
              onOpenThread={openThread}
              onReply={openReply}
              onRepost={openQuote}
            />

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

      <RoomInfoPanel {...roomInfoProps} />

      {infoSheetOpen ? <RoomInfoSheet {...roomInfoProps} onClose={() => setInfoSheetOpen(false)} /> : null}

      {renameDialogOpen ? (
        <RoomNameDialog
          mode="rename"
          initialValue={simulation.title ?? ""}
          onClose={() => setRenameDialogOpen(false)}
          onSave={async (title) => {
            await selectedRoom.rename(title);
            setRenameDialogOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
