import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { FeedFilter, SimulationDto } from "@brickr/shared";

import { ErrorBanner } from "../../components/ErrorBanner";
import { Icon } from "../../components/Icon";
import { Spinner } from "../../components/Spinner";
import { handlePath, postPath } from "../../routes";
import {
  api,
  ApiError,
  isAbortError,
  isForbiddenError,
  isUnauthorizedError,
  toErrorMessage,
} from "../../services/api-client";
import type { ConnectionState } from "../../types";
import { useAuth } from "../auth/AuthContext";
import { Composer } from "../composer/Composer";
import { useCharacters } from "../../hooks/useCharacters";
import { useUserProfile } from "../../hooks/useUserProfile";
import { checkRoomAccess } from "../../app/route-access";
import { FeedFilters } from "../feed/FeedFilters";
import { FeedThreadList } from "../feed/FeedThreadList";
import { useFeed, type FeedScope } from "../feed/useFeed";
import { readFeedFilter, writeFeedFilter } from "./feed-filter-storage";

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connecting: "接続中…",
  open: "接続済み",
  reconnecting: "再接続中…",
  disconnected: "切断中",
};

const CONNECTION_DOT: Record<ConnectionState, string> = {
  connecting: "bg-ink-faint",
  open: "bg-emerald-400",
  reconnecting: "bg-warn",
  disconnected: "bg-ink-faint",
};

function ConnectionBadge({
  connection,
  onToggle,
}: {
  connection: ConnectionState;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface-raised px-2.5 py-1 text-[11px] text-ink-muted"
      title={connection === "disconnected" ? "Backendへ再接続" : "Backendとの接続を切断"}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${CONNECTION_DOT[connection]}`} aria-hidden="true" />
      {CONNECTION_LABEL[connection]}
    </button>
  );
}

type RoomState =
  | { status: "loading" }
  | { status: "denied" }
  | { status: "error"; message: string }
  | { status: "ready"; simulation: SimulationDto };

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
  const { user } = useAuth();
  const navigate = useNavigate();

  const [roomState, setRoomState] = useState<RoomState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setRoomState({ status: "loading" });
    api
      .getSimulation(roomId, controller.signal)
      .then(({ simulation }) => {
        const decision = checkRoomAccess(simulation, user);
        setRoomState(decision.allowed ? { status: "ready", simulation } : { status: "denied" });
      })
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return;
        if (
          isUnauthorizedError(cause) ||
          isForbiddenError(cause) ||
          (cause instanceof ApiError && cause.isNotFound)
        ) {
          setRoomState({ status: "denied" });
          return;
        }
        setRoomState({ status: "error", message: toErrorMessage(cause) });
      });
    return () => controller.abort();
  }, [roomId, user, reloadToken]);

  useEffect(() => {
    if (roomState.status === "denied") {
      navigate("/", { replace: true });
    }
  }, [roomState.status, navigate]);

  const { characters, error: charactersError, reload: reloadCharacters } = useCharacters();
  const userProfile = useUserProfile();

  const [filter, setFilter] = useState<FeedFilter>(readFeedFilter);
  const handleFilterChange = useCallback((next: FeedFilter) => {
    writeFeedFilter(next);
    setFilter(next);
  }, []);

  const [streamEnabled, setStreamEnabled] = useState(true);
  const scope = useMemo<FeedScope>(() => ({ kind: "room", roomId }), [roomId]);
  const feed = useFeed(scope, filter, streamEnabled);

  // Every author clickable from this room is either the signed-in user, a
  // known character, or someone whose post is already loaded - each of which
  // already carries its own handle, so no extra lookup request is needed.
  const authorHandleById = useMemo(() => {
    const map = new Map<string, string>([[userProfile.profile.id, userProfile.profile.handle]]);
    for (const character of characters) {
      map.set(character.id, character.handle);
    }
    for (const thread of feed.threads) {
      map.set(thread.root.author.id, thread.root.author.handle);
      for (const reply of thread.latestReplies) {
        map.set(reply.author.id, reply.author.handle);
      }
    }
    return map;
  }, [characters, feed.threads, userProfile.profile.id, userProfile.profile.handle]);

  const knownHandles = useMemo(() => {
    const handles = new Set<string>([userProfile.profile.handle]);
    for (const character of characters) {
      handles.add(character.handle);
    }
    return handles;
  }, [characters, userProfile.profile.handle]);

  const openAuthor = useCallback(
    (authorId: string) => {
      const handle = authorHandleById.get(authorId);
      if (handle) navigate(handlePath(handle));
    },
    [authorHandleById, navigate],
  );

  const openHandle = useCallback((handle: string) => navigate(handlePath(handle)), [navigate]);
  const openThread = useCallback((postId: string) => navigate(postPath(postId)), [navigate]);

  const [composerOpen, setComposerOpen] = useState(false);

  if (roomState.status === "loading" || roomState.status === "denied") {
    return (
      <div className="flex items-center justify-center px-4 py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  if (roomState.status === "error") {
    return (
      <div className="px-4 py-12">
        <ErrorBanner
          message="ルームを取得できませんでした"
          detail={roomState.message}
          onRetry={() => setReloadToken((value) => value + 1)}
        />
      </div>
    );
  }

  const { simulation } = roomState;
  const isStopped = simulation.status === "stopped";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      <header className="border-b border-line">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">
              {simulation.title ?? "無題のルーム"}
              {isStopped ? "・停止中" : ""}
            </p>
          </div>
          {/* Anonymous generation indicator (§11.2, §16.1) */}
          {feed.activeResponseCount > 0 ? (
            <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface-raised px-2.5 py-1 text-[11px] text-ink-muted">
              <Spinner size="sm" />
              応答を生成中
            </span>
          ) : null}
          <ConnectionBadge
            connection={feed.connection}
            onToggle={() => setStreamEnabled((enabled) => !enabled)}
          />
        </div>

        {/* すべて／自分あて filter, shared with the unified feed (§7.2, §16.1) */}
        <FeedFilters active={filter} onChange={handleFilterChange} />
      </header>

      {!composerOpen ? (
        <div className="border-b border-line px-4 py-3">
          <button
            type="button"
            disabled={isStopped}
            onClick={() => setComposerOpen(true)}
            className="w-full rounded-full bg-accent-strong px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon name="pencil" className="mr-1.5" />
            投稿する
          </button>
        </div>
      ) : (
        <div className="border-b border-line px-4 py-3">
          <Composer
            simulationId={simulation.id}
            characters={characters}
            userProfile={userProfile.profile}
            disabled={isStopped}
            {...(isStopped ? { disabledReason: "このルームは停止しています。" } : {})}
            onPosted={(_post, thread) => {
              feed.upsertThread(thread);
              setComposerOpen(false);
            }}
            onCancel={() => setComposerOpen(false)}
          />
        </div>
      )}

      {charactersError ? (
        <div className="px-4 pt-3">
          <ErrorBanner
            message="キャスト一覧を取得できませんでした"
            detail={charactersError}
            onRetry={reloadCharacters}
          />
        </div>
      ) : null}

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
          {filter === "all" ? (
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
            knownHandles={knownHandles}
            onOpenAuthor={openAuthor}
            onOpenHandle={openHandle}
            onOpenThread={openThread}
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
  );
}
