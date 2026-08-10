import { useCallback, useMemo, useState } from "react";
import { USER_AUTHOR_ID } from "@enjo/shared";
import type {
  CharacterDto,
  SimulationDto,
  UserProfileDto,
} from "@enjo/shared";

import { ErrorBanner } from "../../components/ErrorBanner";
import { Spinner } from "../../components/Spinner";
import { api, toErrorMessage } from "../../services/api-client";
import type { Theme } from "../../services/theme";
import type { ConnectionState, TimelineView } from "../../types";
import { CharacterPicker } from "../characters/CharacterPicker";
import { CharacterEditor } from "../characters/CharacterEditor";
import { UserProfileEditor } from "../user/UserProfileEditor";
import { CharacterProfile } from "../characters/CharacterProfile";
import { Composer } from "../composer/Composer";
import { Timeline } from "../timeline/Timeline";
import {
  selectAuthorTimeline,
  selectUserThreads,
} from "../timeline/thread-utils";
import { useSimulationEvents } from "./useSimulationEvents";

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connecting: "接続中…",
  open: "接続済み",
  reconnecting: "再接続中…",
};

const CONNECTION_DOT: Record<ConnectionState, string> = {
  connecting: "bg-ink-faint",
  open: "bg-emerald-400",
  reconnecting: "bg-warn",
};

function ConnectionBadge({ connection }: { connection: ConnectionState }) {
  return (
    <span
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface-raised px-2.5 py-1 text-[11px] text-ink-muted"
      title="投稿はSSEで順次届きます"
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${CONNECTION_DOT[connection]}`}
        aria-hidden="true"
      />
      {CONNECTION_LABEL[connection]}
    </span>
  );
}

type ProfileInfo = {
  displayName: string;
  handle: string;
  avatarUrl?: string | undefined;
  description: string | null;
};

export type SimulationViewProps = {
  simulation: SimulationDto;
  characters: CharacterDto[];
  charactersLoading: boolean;
  charactersError: string | null;
  onReloadCharacters: () => void;
  onSimulationUpdated: (simulation: SimulationDto) => void;
  userProfile: UserProfileDto;
  userProfileError: string | null;
  onReloadUserProfile: () => void;
  onUserProfileUpdated: (profile: UserProfileDto) => void;
  theme: Theme;
  onToggleTheme: () => void;
  bootstrapError?: string | null;
  onDismissBootstrapError?: () => void;
};

export function SimulationView({
  simulation,
  characters,
  charactersLoading,
  charactersError,
  onReloadCharacters,
  onSimulationUpdated,
  userProfile,
  userProfileError,
  onReloadUserProfile,
  onUserProfileUpdated,
  theme,
  onToggleTheme,
  bootstrapError,
  onDismissBootstrapError,
}: SimulationViewProps) {
  const events = useSimulationEvents(simulation.id);

  const [view, setView] = useState<TimelineView>({ kind: "home" });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingMention, setPendingMention] = useState<string | null>(null);
  const [changingStatus, setChangingStatus] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ characterId: string | null } | null>(null);
  const [userEditorOpen, setUserEditorOpen] = useState(false);

  const isStopped = simulation.status === "stopped";
  const canPost = !isStopped;

  const openAuthor = useCallback((authorId: string) => {
    // The user's timeline is the home view: new posts start threads there, and
    // replies remain visible inside those threads rather than in a duplicate
    // author-only screen.
    setView(
      authorId === USER_AUTHOR_ID
        ? { kind: "home" }
        : { kind: "timeline", authorId },
    );
    setSidebarOpen(false);
    window.scrollTo({ top: 0 });
  }, []);

  const goHome = useCallback(() => {
    setView({ kind: "home" });
    window.scrollTo({ top: 0 });
  }, []);

  const consumePendingMention = useCallback(() => {
    setPendingMention(null);
  }, []);

  const handleMention = useCallback((handle: string) => {
    setPendingMention(handle);
    setView({ kind: "home" });
    window.scrollTo({ top: 0 });
  }, []);

  // Home shows only the user's own thread starters, newest first.
  const homeThreads = useMemo(
    () => selectUserThreads(events.posts),
    [events.posts],
  );

  const userPostCount = useMemo(
    () => events.posts.filter((post) => post.authorId === USER_AUTHOR_ID).length,
    [events.posts],
  );

  const authorId = view.kind === "timeline" ? view.authorId : null;

  const authorPosts = useMemo(
    () => (authorId === null ? [] : selectAuthorTimeline(events.posts, authorId)),
    [events.posts, authorId],
  );

  const profile = useMemo<ProfileInfo | null>(() => {
    if (authorId === null) {
      return null;
    }
    const character = characters.find((item) => item.id === authorId);
    if (character) {
      return {
        displayName: character.displayName,
        handle: character.handle,
        avatarUrl: character.avatarUrl,
        description: character.description,
      };
    }
    // Unknown author (e.g. the roster failed to load): fall back to post data.
    const author = authorPosts[0]?.author;
    if (author) {
      return {
        displayName: author.displayName,
        handle: author.handle,
        avatarUrl: author.avatarUrl,
        description: null,
      };
    }
    return null;
  }, [authorId, authorPosts, characters]);

  const handleStatusChange = (): void => {
    setChangingStatus(true);
    setStopError(null);
    const update = isStopped
      ? api.resumeSimulation(simulation.id)
      : api.stopSimulation(simulation.id);
    void update
      .then((updated) => {
        onSimulationUpdated(updated);
      })
      .catch((cause: unknown) => {
        setStopError(toErrorMessage(cause));
      })
      .finally(() => {
        setChangingStatus(false);
      });
  };

  const failureDetail = events.failures
    .map((failure) => `${failure.label}: ${failure.reason}`)
    .join(" / ");

  const sidebar = (
    <CharacterPicker
      characters={characters}
      loading={charactersLoading}
      selectedId={authorId}
      onSelect={(character) => {
        openAuthor(character.id);
      }}
      onCreate={() => {
        setSidebarOpen(false);
        setEditor({ characterId: null });
      }}
      onEdit={(character) => {
        setSidebarOpen(false);
        setEditor({ characterId: character.id });
      }}
    />
  );

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[1000px] items-center gap-3 px-4 py-2.5">
          <button
            type="button"
            onClick={goHome}
            aria-label="炎上シミュレータのホームへ戻る"
            className="flex min-w-0 items-center gap-2 rounded-lg text-left hover:opacity-80"
          >
            <span className="text-lg leading-none" aria-hidden="true">
              🔥
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold text-ink">
                炎上シミュレータ
              </h1>
              <p className="truncate text-[11px] text-ink-faint">
                {simulation.title ?? "無題のスレッド"}
                {isStopped ? "・停止中" : ""}
              </p>
            </div>
          </button>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <span className="hidden sm:block">
              <ConnectionBadge connection={events.connection} />
            </span>

            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={theme === "dark" ? "ライトモードに切り替える" : "ダークモードに切り替える"}
              title={theme === "dark" ? "ライトモード" : "ダークモード"}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-line text-sm text-ink-muted transition hover:border-line-strong hover:text-ink"
            >
              <span aria-hidden="true">{theme === "dark" ? "☀️" : "🌙"}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setSidebarOpen(true);
              }}
              className="rounded-full border border-line px-3 py-1 text-xs text-ink-muted transition hover:border-line-strong hover:text-ink lg:hidden"
            >
              キャラ{characters.length > 0 ? `(${String(characters.length)})` : ""}
            </button>

            <button
              type="button"
              onClick={handleStatusChange}
              disabled={changingStatus}
              className={`rounded-full border px-3 py-1 text-xs transition disabled:opacity-50 ${
                isStopped
                  ? "border-accent/50 text-accent hover:bg-accent/10"
                  : "border-line text-ink-muted hover:border-danger/60 hover:text-danger"
              }`}
            >
              {changingStatus
                ? isStopped
                  ? "再開中…"
                  : "停止中…"
                : isStopped
                  ? "再開"
                  : "停止"}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1000px] justify-center gap-6 px-0 lg:px-4">
        <main className="min-w-0 w-full max-w-[600px] border-x border-line pb-24">
          {view.kind === "timeline" ? (
            <>
              <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
                <button
                  type="button"
                  onClick={goHome}
                  aria-label="ホームに戻る"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition hover:bg-surface-hover hover:text-ink"
                >
                  <span aria-hidden="true">←</span>
                </button>
                <p className="min-w-0 truncate text-sm font-semibold text-ink">
                  {profile
                    ? `@${profile.handle} のタイムライン`
                    : "タイムライン"}
                </p>
              </div>

              {profile ? (
                <CharacterProfile
                  displayName={profile.displayName}
                  handle={profile.handle}
                  avatarUrl={profile.avatarUrl}
                  description={profile.description}
                  postCount={authorPosts.length}
                  {...(isStopped ? {} : { onMention: handleMention })}
                  onEdit={() => setEditor({ characterId: authorId })}
                />
              ) : null}
            </>
          ) : (
            <>
              <CharacterProfile
                displayName={userProfile.displayName}
                handle={userProfile.handle}
                avatarUrl={userProfile.avatarUrl}
                description={userProfile.description}
                postCount={userPostCount}
                onEdit={() => setUserEditorOpen(true)}
              />
              <Composer
                simulationId={simulation.id}
                characters={characters}
                userProfile={userProfile}
                disabled={isStopped}
                {...(isStopped
                  ? {
                      disabledReason:
                        "このシミュレーションは停止しています。",
                    }
                  : {})}
                onPosted={events.addLocalPost}
                onOpenUser={goHome}
                pendingMention={pendingMention}
                onPendingMentionConsumed={consumePendingMention}
              />
            </>
          )}

          {bootstrapError ? (
            <div className="px-4 pt-3">
              <ErrorBanner
                message="シミュレーションの操作に失敗しました"
                detail={bootstrapError}
                {...(onDismissBootstrapError
                  ? { onDismiss: onDismissBootstrapError }
                  : {})}
              />
            </div>
          ) : null}

          {stopError ? (
            <div className="px-4 pt-3">
              <ErrorBanner
                message={isStopped ? "再開できませんでした" : "停止できませんでした"}
                detail={stopError}
                onDismiss={() => {
                  setStopError(null);
                }}
              />
            </div>
          ) : null}

          {charactersError ? (
            <div className="px-4 pt-3">
              <ErrorBanner
                message="キャラクター一覧を取得できませんでした"
                detail={charactersError}
                onRetry={onReloadCharacters}
              />
            </div>
          ) : null}

          {userProfileError ? (
            <div className="px-4 pt-3">
              <ErrorBanner
                message="ユーザープロフィールを取得できませんでした"
                detail={userProfileError}
                onRetry={onReloadUserProfile}
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

          {events.failures.length > 0 ? (
            <div className="px-4 pt-3">
              <ErrorBanner
                tone="warning"
                message="一部のキャラクターは応答できませんでした（他のキャラクターは継続します）"
                detail={failureDetail}
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

          {view.kind === "home" ? (
            <Timeline
              simulationId={simulation.id}
              rootPosts={homeThreads}
              allPosts={events.posts}
              characters={characters}
              userProfile={userProfile}
              thinking={events.thinking}
              loading={events.loading}
              canPost={canPost}
              emptyTitle="まだスレッドがありません"
              emptyBody={
                "上のフォームから投稿すると、あなたのスレッドがここに並びます。\nキャラクターの反応は各スレッドの「返信を表示」から読めます。"
              }
              onOpenAuthor={openAuthor}
              onPosted={events.addLocalPost}
            />
          ) : (
            <Timeline
              simulationId={simulation.id}
              rootPosts={authorPosts}
              allPosts={events.posts}
              characters={characters}
              userProfile={userProfile}
              thinking={events.thinking}
              loading={events.loading}
              canPost={canPost}
              emptyTitle="まだ投稿がありません"
              emptyBody="このキャラクターはまだこのシミュレーションで発言していません。"
              onOpenAuthor={openAuthor}
              onPosted={events.addLocalPost}
            />
          )}
        </main>

        <aside className="hidden w-[320px] shrink-0 py-4 lg:block">
          <div className="sticky top-[4.5rem]">{sidebar}</div>
        </aside>
      </div>

      {sidebarOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="閉じる"
            onClick={() => {
              setSidebarOpen(false);
            }}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />
          <div className="absolute inset-y-0 right-0 w-[88%] max-w-sm overflow-y-auto bg-canvas p-3">
            {sidebar}
          </div>
        </div>
      ) : null}

      {editor ? (
        <CharacterEditor
          characterId={editor.characterId}
          onClose={() => setEditor(null)}
          onSaved={(saved) => {
            setEditor(null);
            onReloadCharacters();
            openAuthor(saved.id);
          }}
        />
      ) : null}

      {userEditorOpen ? (
        <UserProfileEditor
          profile={userProfile}
          onClose={() => setUserEditorOpen(false)}
          onSaved={(saved) => {
            onUserProfileUpdated(saved);
            setUserEditorOpen(false);
            events.reload();
          }}
        />
      ) : null}
    </div>
  );
}
