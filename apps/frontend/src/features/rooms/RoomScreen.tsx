import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { SimulationDto } from "@brickr/shared";

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
import { Timeline } from "../timeline/Timeline";
import { selectRoomTimeline } from "../timeline/thread-utils";
import { useCharacters } from "../../hooks/useCharacters";
import { useUserProfile } from "../../hooks/useUserProfile";
import { checkRoomAccess } from "../../app/route-access";
import { useSimulationEvents } from "../simulation/useSimulationEvents";

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
 * showing, so its SSE subscription and loaded posts survive navigating away
 * and back. Everything that used to be app-wide chrome in the old
 * SimulationView (top header, character/room picker sidebar, cross-screen
 * view switching) now lives in AppShell/AppNavigation instead - this
 * component only knows how to render one room.
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

  const [streamEnabled, setStreamEnabled] = useState(true);
  const events = useSimulationEvents(roomId, streamEnabled);

  const handleForAuthorId = useCallback(
    (authorId: string): string | null => {
      if (authorId === userProfile.profile.id) return userProfile.profile.handle;
      const character = characters.find((item) => item.id === authorId);
      if (character) return character.handle;
      const post = events.posts.find((item) => item.author.id === authorId);
      return post?.author.handle ?? null;
    },
    [characters, events.posts, userProfile.profile.id, userProfile.profile.handle],
  );

  const openAuthor = useCallback(
    (authorId: string) => {
      const handle = handleForAuthorId(authorId);
      if (handle) navigate(handlePath(handle));
    },
    [navigate, handleForAuthorId],
  );

  const openPost = useCallback(
    (postId: string) => {
      navigate(postPath(postId));
    },
    [navigate],
  );

  const roomPosts = useMemo(() => selectRoomTimeline(events.posts), [events.posts]);

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
  const canPost = !isStopped;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">
            {simulation.title ?? "無題のルーム"}
            {isStopped ? "・停止中" : ""}
          </p>
        </div>
        <ConnectionBadge
          connection={events.connection}
          onToggle={() => setStreamEnabled((enabled) => !enabled)}
        />
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
            onPosted={(post) => {
              events.addLocalPost(post);
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

      {events.error ? (
        <div className="px-4 pt-3">
          <ErrorBanner
            message="タイムラインの取得に問題が発生しました"
            detail={events.error}
            onRetry={events.reload}
            onDismiss={events.dismissError}
          />
        </div>
      ) : null}

      {events.failedResponses > 0 ? (
        <div className="px-4 pt-3">
          {/* Aggregated on purpose (§11.2): naming who failed, or why, would
              describe the machinery behind a post. Details stay in the log. */}
          <ErrorBanner
            tone="warning"
            message="一部の応答を生成できませんでした"
            onDismiss={events.dismissFailures}
          />
        </div>
      ) : null}

      {events.connection === "reconnecting" ? (
        <p className="flex items-center gap-2 border-b border-line px-4 py-2 text-xs text-warn">
          <Spinner size="sm" />
          リアルタイム接続が切れました。再接続中です…
        </p>
      ) : null}

      <Timeline
        simulationId={simulation.id}
        rootPosts={roomPosts}
        allPosts={events.posts}
        characters={characters}
        userProfile={userProfile.profile}
        activities={events.activities}
        loading={events.loading}
        canPost={canPost}
        emptyTitle="まだ投稿がありません"
        emptyBody="上のフォームから投稿すると、このルームのスレッドがここに並びます。"
        onOpenAuthor={openAuthor}
        onOpenPost={openPost}
        onPosted={events.addLocalPost}
      />
    </div>
  );
}
