import { useCallback, useMemo, useState } from "react";
import { USER_AUTHOR_ID } from "@brickr/shared";
import type {
  CharacterDto,
  SimulationDto,
  SimulationSummaryDto,
  UserProfileDto,
} from "@brickr/shared";

import { APP_NAME, APP_TAGLINE } from "../../brand";
import { BrandLogo } from "../../components/BrandLogo";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Icon } from "../../components/Icon";
import { Spinner } from "../../components/Spinner";
import type { Theme } from "../../services/theme";
import type { ConnectionState, TimelineView } from "../../types";
import { CharacterPicker } from "../characters/CharacterPicker";
import { CharacterEditor } from "../characters/CharacterEditor";
import { CharacterList } from "../characters/CharacterList";
import { UserProfileEditor } from "../user/UserProfileEditor";
import { CharacterProfile } from "../characters/CharacterProfile";
import { Composer } from "../composer/Composer";
import { Timeline } from "../timeline/Timeline";
import { PostDetail } from "../timeline/PostDetail";
import {
  selectAuthorTimeline,
  selectUserTimeline,
} from "../timeline/thread-utils";
import { useSimulationEvents } from "./useSimulationEvents";
import { SimulationList } from "./SimulationList";
import { SimulationPicker } from "./SimulationPicker";
import { SimulationAnalysis } from "./SimulationAnalysis";
import { SimulationNameDialog } from "./SimulationNameDialog";

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
      <span
        className={`h-1.5 w-1.5 rounded-full ${CONNECTION_DOT[connection]}`}
        aria-hidden="true"
      />
      {CONNECTION_LABEL[connection]}
    </button>
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
  simulations: SimulationSummaryDto[];
  simulationsLoading: boolean;
  simulationsError: string | null;
  onReloadSimulations: () => void;
  onSelectSimulation: (id: string) => Promise<void>;
  onCreateSimulation: (title: string) => Promise<void>;
  onRenameSimulation: (id: string, title: string) => Promise<void>;
  characters: CharacterDto[];
  charactersLoading: boolean;
  charactersError: string | null;
  onReloadCharacters: () => void;
  onCharactersDeleted: (ids: string[]) => void;
  userProfile: UserProfileDto;
  userProfileError: string | null;
  onReloadUserProfile: () => void;
  onUserProfileUpdated: (profile: UserProfileDto) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  bootstrapError?: string | null;
  onDismissBootstrapError?: () => void;
};

export function SimulationView({
  simulation,
  simulations,
  simulationsLoading,
  simulationsError,
  onReloadSimulations,
  onSelectSimulation,
  onCreateSimulation,
  onRenameSimulation,
  characters,
  charactersLoading,
  charactersError,
  onReloadCharacters,
  onCharactersDeleted,
  userProfile,
  userProfileError,
  onReloadUserProfile,
  onUserProfileUpdated,
  theme,
  onThemeChange,
  bootstrapError,
  onDismissBootstrapError,
}: SimulationViewProps) {
  const [streamEnabled, setStreamEnabled] = useState(true);
  const events = useSimulationEvents(simulation.id, streamEnabled);

  const [view, setView] = useState<TimelineView>({ kind: "home" });
  const [postReturnView, setPostReturnView] = useState<TimelineView>({ kind: "home" });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"characters" | "simulations">("characters");
  const [pendingMention, setPendingMention] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editor, setEditor] = useState<{ characterId: string | null } | null>(null);
  const [userEditorOpen, setUserEditorOpen] = useState(false);
  const [simulationNameDialog, setSimulationNameDialog] = useState<
    { mode: "create" } | { mode: "rename"; simulation: SimulationSummaryDto } | null
  >(null);

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
    setComposerOpen(false);
    window.scrollTo({ top: 0 });
  }, []);

  const goHome = useCallback(() => {
    setView({ kind: "home" });
    setComposerOpen(false);
    window.scrollTo({ top: 0 });
  }, []);

  const openCharacterList = useCallback(() => {
    setView({ kind: "characters" });
    setSidebarOpen(false);
    window.scrollTo({ top: 0 });
  }, []);

  const openSimulationList = useCallback(() => {
    setView({ kind: "simulations" });
    setSidebarOpen(false);
    window.scrollTo({ top: 0 });
  }, []);

  const openSimulationAnalysis = useCallback((simulationId: string) => {
    setView({ kind: "simulation-analysis", simulationId });
    setSidebarOpen(false);
    window.scrollTo({ top: 0 });
  }, []);

  const openPost = useCallback(
    (postId: string) => {
      if (view.kind !== "post") setPostReturnView(view);
      setView({ kind: "post", postId });
      setSidebarOpen(false);
      window.scrollTo({ top: 0 });
    },
    [view],
  );

  const consumePendingMention = useCallback(() => {
    setPendingMention(null);
  }, []);

  const handleMention = useCallback((handle: string) => {
    setPendingMention(handle);
    setComposerOpen(true);
    setView({ kind: "home" });
    window.scrollTo({ top: 0 });
  }, []);

  // Home shows the user's thread starters and posts that mention @you.
  const homePosts = useMemo(
    () => selectUserTimeline(events.posts),
    [events.posts],
  );

  const userPostCount = useMemo(
    () => events.posts.filter((post) => post.authorId === USER_AUTHOR_ID).length,
    [events.posts],
  );

  const authorId = view.kind === "timeline" ? view.authorId : null;
  const selectedPost = useMemo(
    () =>
      view.kind === "post"
        ? events.posts.find((post) => post.id === view.postId) ?? null
        : null,
    [events.posts, view],
  );

  const selectedCharacter = useMemo(
    () => (authorId === null ? null : characters.find((item) => item.id === authorId) ?? null),
    [authorId, characters],
  );

  const authoredPost = useMemo(
    () =>
      authorId === null
        ? undefined
        : events.posts.find(
            (post) => post.authorId === authorId || post.author.id === authorId,
          ),
    [authorId, events.posts],
  );

  const authorHandle = selectedCharacter?.handle ?? authoredPost?.author.handle;

  const authorPosts = useMemo(
    () =>
      authorId === null
        ? []
        : selectAuthorTimeline(events.posts, authorId, authorHandle),
    [events.posts, authorId, authorHandle],
  );

  const authorPostCount = useMemo(
    () =>
      authorId === null
        ? 0
        : events.posts.filter(
            (post) => post.authorId === authorId || post.author.id === authorId,
          ).length,
    [authorId, events.posts],
  );

  const profile = useMemo<ProfileInfo | null>(() => {
    if (authorId === null) {
      return null;
    }
    if (selectedCharacter) {
      return {
        displayName: selectedCharacter.displayName,
        handle: selectedCharacter.handle,
        avatarUrl: selectedCharacter.avatarUrl,
        description: selectedCharacter.description,
      };
    }
    // Unknown author (e.g. the roster failed to load): fall back to post data.
    const author = authoredPost?.author;
    if (author) {
      return {
        displayName: author.displayName,
        handle: author.handle,
        avatarUrl: author.avatarUrl,
        description: null,
      };
    }
    return null;
  }, [authorId, authoredPost, selectedCharacter]);

  const failureDetail = events.failures
    .map((failure) => `${failure.label}: ${failure.reason}`)
    .join(" / ");

  const sidebar = (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <button
          type="button"
          onClick={sidebarTab === "characters" ? openCharacterList : openSimulationList}
          className="flex min-w-0 items-center gap-2 rounded-md text-left text-sm font-semibold text-ink transition hover:text-accent"
        >
          <Icon name={sidebarTab === "characters" ? "list" : "clock-history"} className="text-base" />
          <span className="truncate">{sidebarTab === "characters" ? "キャラクター一覧" : "シミュレーション履歴"}</span>
        </button>
        <span className="shrink-0 rounded-full bg-surface-raised px-2 py-0.5 text-xs text-ink-muted">
          {sidebarTab === "characters" ? `${String(characters.length)}人` : `${String(simulations.length)}件`}
        </span>
      </header>
      <div className="grid grid-cols-2 border-b border-line bg-surface-muted p-1">
        <button type="button" onClick={() => setSidebarTab("characters")} className={`rounded-lg px-2 py-1.5 text-xs font-semibold ${sidebarTab === "characters" ? "bg-surface text-accent shadow-sm" : "text-ink-muted"}`}>
          <Icon name="people" className="mr-1" />キャラクター
        </button>
        <button type="button" onClick={() => setSidebarTab("simulations")} className={`rounded-lg px-2 py-1.5 text-xs font-semibold ${sidebarTab === "simulations" ? "bg-surface text-accent shadow-sm" : "text-ink-muted"}`}>
          <Icon name="clock-history" className="mr-1" />履歴
        </button>
      </div>
      {sidebarTab === "characters" ? (
        <CharacterPicker
          embedded
          characters={characters}
          loading={charactersLoading}
          selectedId={authorId}
          onSelect={(character) => openAuthor(character.id)}
          onEdit={(character) => {
            setSidebarOpen(false);
            setEditor({ characterId: character.id });
          }}
          onOpenList={openCharacterList}
        />
      ) : (
        <SimulationPicker
          simulations={simulations}
          currentId={simulation.id}
          loading={simulationsLoading}
          error={simulationsError}
          onRetry={onReloadSimulations}
          onSelect={onSelectSimulation}
          onCreate={() => setSimulationNameDialog({ mode: "create" })}
          onRename={(item) => setSimulationNameDialog({ mode: "rename", simulation: item })}
          onAnalyze={openSimulationAnalysis}
        />
      )}
    </section>
  );

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[1000px] items-center gap-3 px-4 py-2.5">
          <button
            type="button"
            onClick={goHome}
            aria-label={`${APP_NAME}のホームへ戻る`}
            className="flex min-w-0 items-center gap-2 rounded-lg text-left hover:opacity-80"
          >
            <BrandLogo className="h-7 w-7" />
            <div className="min-w-0">
              <h1 className="flex min-w-0 items-baseline gap-1 truncate text-base font-bold text-ink">
                <span>{APP_NAME}</span>
                <span className="hidden truncate text-[11px] font-normal text-ink-faint sm:inline">
                  — {APP_TAGLINE}
                </span>
              </h1>
              <p className="truncate text-[11px] text-ink-faint">
                {simulation.title ?? "無題のスレッド"}
                {isStopped ? "・停止中" : ""}
              </p>
            </div>
          </button>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ConnectionBadge
              connection={events.connection}
              onToggle={() => setStreamEnabled((enabled) => !enabled)}
            />

            <button
              type="button"
              onClick={() => {
                setSidebarTab("characters");
                setSidebarOpen(true);
              }}
              className="rounded-full border border-line px-3 py-1 text-xs text-ink-muted transition hover:border-line-strong hover:text-ink lg:hidden"
            >
              パネル
            </button>

          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1000px] justify-center gap-6 px-0 lg:px-4">
        <main
          className={`min-w-0 w-full border-x border-line pb-24 ${
            view.kind === "characters" || view.kind === "simulations" || view.kind === "simulation-analysis" ? "max-w-[1000px]" : "max-w-[600px]"
          }`}
        >
          {view.kind === "timeline" ? (
            <div className="sticky top-[3.65rem] z-20 bg-canvas shadow-sm">
              <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
                <button
                  type="button"
                  onClick={goHome}
                  aria-label="ホームに戻る"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition hover:bg-surface-hover hover:text-ink"
                >
                  <Icon name="arrow-left" />
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
                  postCount={authorPostCount}
                  {...(isStopped ? {} : { onMention: handleMention })}
                  onEdit={() => setEditor({ characterId: authorId })}
                />
              ) : null}
            </div>
          ) : view.kind === "post" ? (
            <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
              <button
                type="button"
                onClick={() => {
                  setView(postReturnView.kind === "post" ? { kind: "home" } : postReturnView);
                  window.scrollTo({ top: 0 });
                }}
                aria-label="前の画面に戻る"
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition hover:bg-surface-hover hover:text-ink"
              >
                <Icon name="arrow-left" />
              </button>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">投稿の詳細</p>
                <p className="text-xs text-ink-faint">返信とリポストをすべて表示</p>
              </div>
            </div>
          ) : view.kind === "characters" || view.kind === "simulations" || view.kind === "simulation-analysis" ? (
            <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
              <button
                type="button"
                  onClick={view.kind === "simulation-analysis" ? openSimulationList : goHome}
                aria-label="ホームに戻る"
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition hover:bg-surface-hover hover:text-ink"
              >
                <Icon name="arrow-left" />
              </button>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">
                  {view.kind === "characters"
                    ? "キャラクター一覧"
                    : view.kind === "simulations"
                      ? "シミュレーション一覧"
                      : simulations.find((item) => item.id === view.simulationId)?.title ?? "シミュレーション分析"}
                </p>
                <p className="text-xs text-ink-faint">
                  {view.kind === "characters"
                    ? "作成・編集・削除"
                    : view.kind === "simulations"
                      ? "履歴の確認・復帰・新規開始"
                      : "シミュレーション全体の分析"}
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="sticky top-[3.65rem] z-20 bg-canvas shadow-sm">
                <CharacterProfile
                  displayName={userProfile.displayName}
                  handle={userProfile.handle}
                  avatarUrl={userProfile.avatarUrl}
                  description={userProfile.description}
                  postCount={userPostCount}
                  onEdit={() => setUserEditorOpen(true)}
                />
                {!composerOpen ? (
                  <div className="border-b border-line px-4 py-3">
                    <button
                      type="button"
                      disabled={isStopped}
                      onClick={() => {
                        setComposerOpen(true);
                        window.scrollTo({ top: 0 });
                      }}
                      className="w-full rounded-full bg-accent-strong px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Icon name="pencil" className="mr-1.5" />
                      投稿する
                    </button>
                  </div>
                ) : null}
              </div>
              {composerOpen ? (
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
                  onPosted={(post) => {
                    events.addLocalPost(post);
                    setComposerOpen(false);
                  }}
                  onOpenUser={goHome}
                  onCancel={() => setComposerOpen(false)}
                  pendingMention={pendingMention}
                  onPendingMentionConsumed={consumePendingMention}
                />
              ) : null}
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

          {view.kind === "characters" ? (
            <CharacterList
              characters={characters}
              loading={charactersLoading}
              onCreate={() => setEditor({ characterId: null })}
              onEdit={(character) => setEditor({ characterId: character.id })}
              onOpenTimeline={(character) => openAuthor(character.id)}
              onDeleted={onCharactersDeleted}
              onCreated={onReloadCharacters}
            />
          ) : view.kind === "simulations" ? (
            <SimulationList
              simulations={simulations}
              currentId={simulation.id}
              loading={simulationsLoading}
              error={simulationsError}
              onRetry={onReloadSimulations}
              onSelect={onSelectSimulation}
              onCreate={() => setSimulationNameDialog({ mode: "create" })}
              onRename={(item) => setSimulationNameDialog({ mode: "rename", simulation: item })}
              onAnalyze={openSimulationAnalysis}
            />
          ) : view.kind === "simulation-analysis" ? (
            <SimulationAnalysis simulationId={view.simulationId} />
          ) : view.kind === "post" ? (
            selectedPost ? (
              <PostDetail
                simulationId={simulation.id}
                post={selectedPost}
                allPosts={events.posts}
                characters={characters}
                userProfile={userProfile}
                thinking={events.thinking}
                canPost={canPost}
                onOpenAuthor={openAuthor}
                onOpenPost={openPost}
                onPosted={events.addLocalPost}
              />
            ) : (
              <div className="px-4 py-12">
                <ErrorBanner
                  message="投稿が見つかりませんでした"
                  detail="投稿が削除されたか、まだ読み込まれていない可能性があります。"
                  onRetry={events.reload}
                />
              </div>
            )
          ) : view.kind === "home" ? (
            <Timeline
              key="home"
              simulationId={simulation.id}
              rootPosts={homePosts}
              allPosts={events.posts}
              characters={characters}
              userProfile={userProfile}
              thinking={events.thinking}
              loading={events.loading}
              canPost={canPost}
              emptyTitle="まだスレッドやメンションがありません"
              emptyBody={
                "上のフォームから投稿すると、あなたのスレッドがここに並びます。\nキャラクターの反応は各スレッドの「返信を表示」から読めます。"
              }
              onOpenAuthor={openAuthor}
              onOpenPost={openPost}
              onPosted={events.addLocalPost}
            />
          ) : (
            <Timeline
              key={`timeline:${authorId ?? "unknown"}`}
              simulationId={simulation.id}
              rootPosts={authorPosts}
              allPosts={events.posts}
              characters={characters}
              userProfile={userProfile}
              thinking={events.thinking}
              loading={events.loading}
              canPost={canPost}
              emptyTitle="まだ投稿やメンションがありません"
              emptyBody="このキャラクターはまだ発言しておらず、メンションもされていません。"
              onOpenAuthor={openAuthor}
              onOpenPost={openPost}
              onPosted={events.addLocalPost}
            />
          )}
        </main>

        {view.kind !== "characters" && view.kind !== "simulations" && view.kind !== "simulation-analysis" ? (
          <aside className={`relative hidden shrink-0 py-4 transition-[width] lg:block ${sidebarCollapsed ? "w-12" : "w-[320px]"}`}>
            <div className="sticky top-[4.5rem]">
              <button
                type="button"
                onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
                title={sidebarCollapsed ? "パネルを展開" : "パネルを折りたたむ"}
                aria-label={sidebarCollapsed ? "パネルを展開" : "パネルを折りたたむ"}
                className="mb-2 flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-ink-muted transition hover:text-accent"
              >
                <Icon name={sidebarCollapsed ? "chevron-left" : "chevron-right"} />
              </button>
              {!sidebarCollapsed ? sidebar : null}
            </div>
          </aside>
        ) : null}
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
            if (view.kind !== "characters") {
              openAuthor(saved.id);
            }
          }}
        />
      ) : null}

      {userEditorOpen ? (
        <UserProfileEditor
          profile={userProfile}
          theme={theme}
          onThemeChange={onThemeChange}
          onClose={() => setUserEditorOpen(false)}
          onSaved={(saved) => {
            onUserProfileUpdated(saved);
            setUserEditorOpen(false);
            events.reload();
          }}
        />
      ) : null}

      {simulationNameDialog ? (
        <SimulationNameDialog
          mode={simulationNameDialog.mode}
          {...(simulationNameDialog.mode === "rename"
            ? { initialValue: simulationNameDialog.simulation.title ?? "" }
            : {})}
          onClose={() => setSimulationNameDialog(null)}
          onSave={(title) =>
            simulationNameDialog.mode === "create"
              ? onCreateSimulation(title)
              : onRenameSimulation(simulationNameDialog.simulation.id, title)
          }
        />
      ) : null}
    </div>
  );
}
