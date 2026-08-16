import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PostDto, PublicProfileDto } from "@brickr/shared";

import { ErrorBanner } from "../../components/ErrorBanner";
import { Spinner } from "../../components/Spinner";
import { useAuth } from "../auth/AuthContext";
import { CharacterEditor } from "../characters/CharacterEditor";
import { CharacterProfile } from "../characters/CharacterProfile";
import { PostCard } from "../timeline/PostCard";
import { classifyHandleResolutionError } from "../simulation/handle-resolution";
import { api, isAbortError, toErrorMessage } from "../../services/api-client";
import { postPath, settingsPath } from "../../routes";

type ProfileState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "ready"; profile: PublicProfileDto };

type PostsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; posts: PostDto[]; nextCursor: string | null };

/**
 * The shared public profile (§9.2, §10.6, §21) - one layout for a person and
 * an AI cast member alike. A top-level route (unlike Feed/Room, this is not
 * kept mounted across navigations per §13.5): opening and leaving a profile
 * costs a re-fetch, which is acceptable for a screen nobody reads for long.
 */
export function PublicProfileScreen({ handle }: { handle: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [profileState, setProfileState] = useState<ProfileState>({ status: "loading" });
  const [postsState, setPostsState] = useState<PostsState>({ status: "loading" });
  const [editingCharacterId, setEditingCharacterId] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setProfileState({ status: "loading" });
    api
      .resolveProfile(handle, controller.signal)
      .then((profile) => setProfileState({ status: "ready", profile }))
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return;
        if (classifyHandleResolutionError(cause) === "not-found") {
          setProfileState({ status: "not-found" });
          return;
        }
        setProfileState({ status: "error", message: toErrorMessage(cause) });
      });
    return () => controller.abort();
  }, [handle, retryToken]);

  useEffect(() => {
    const controller = new AbortController();
    setPostsState({ status: "loading" });
    api
      .getProfilePosts(handle, undefined, controller.signal)
      .then((page) => setPostsState({ status: "ready", posts: page.posts, nextCursor: page.nextCursor }))
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return;
        setPostsState({ status: "error", message: toErrorMessage(cause) });
      });
    return () => controller.abort();
  }, [handle, retryToken]);

  const loadMore = () => {
    if (postsState.status !== "ready" || postsState.nextCursor === null) return;
    const cursor = postsState.nextCursor;
    api
      .getProfilePosts(handle, cursor)
      .then((page) =>
        setPostsState((current) =>
          current.status === "ready"
            ? { status: "ready", posts: [...current.posts, ...page.posts], nextCursor: page.nextCursor }
            : current,
        ),
      )
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return;
        setPostsState({ status: "error", message: toErrorMessage(cause) });
      });
  };

  const retry = () => setRetryToken((value) => value + 1);

  if (profileState.status === "loading") {
    return (
      <div className="flex items-center justify-center px-4 py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  if (profileState.status === "not-found") {
    return (
      <div className="px-4 py-12">
        <ErrorBanner
          message="ページが見つかりませんでした"
          detail={`@${handle} に一致するユーザーまたはキャストは見つかりませんでした。`}
          onRetry={() => navigate("/")}
          retryLabel="ホームへ戻る"
        />
      </div>
    );
  }

  if (profileState.status === "error") {
    return (
      <div className="px-4 py-12">
        <ErrorBanner
          tone="warning"
          message="読み込みに失敗しました"
          detail={profileState.message}
          onRetry={retry}
        />
      </div>
    );
  }

  const { profile } = profileState;
  // A handle only ever names one signed-in account, so this is a safe "is it
  // me" check - unlike `canEdit`, which is deliberately silent on that (§21).
  const isSelf = user !== null && user.handle === profile.handle;

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* Sticks to the viewport top (CLAUDE.md §48: "Profile領域はアプリヘッダー
          直下にsticky表示"); only the post list beneath scrolls. */}
      <div className="sticky top-0 z-10 bg-canvas/95 backdrop-blur">
        <CharacterProfile
          displayName={profile.displayName}
          handle={profile.handle}
          avatarUrl={profile.avatarUrl}
          description={profile.description ?? null}
          postCount={profile.postCount}
          {...(profile.canEdit
            ? {
                onEdit: () => {
                  if (isSelf) {
                    navigate(settingsPath("profile"), { state: { returnTo: `/${profile.handle}` } });
                  } else {
                    setEditingCharacterId(profile.id);
                  }
                },
              }
            : {})}
        />
      </div>

      {postsState.status === "loading" ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : postsState.status === "error" ? (
        <div className="px-4 pt-3">
          <ErrorBanner message="投稿一覧を取得できませんでした" detail={postsState.message} onRetry={retry} />
        </div>
      ) : postsState.posts.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-ink-faint">まだ投稿がありません</p>
      ) : (
        <>
          <ul>
            {postsState.posts.map((post) => (
              <li key={post.id}>
                <PostCard post={post} onExpand={(postId) => navigate(postPath(postId))} />
              </li>
            ))}
          </ul>
          {postsState.nextCursor !== null ? (
            <div className="flex justify-center py-4">
              <button
                type="button"
                onClick={loadMore}
                className="rounded-full border border-line px-4 py-1.5 text-sm text-ink-muted transition hover:border-line-strong hover:text-ink"
              >
                さらに表示
              </button>
            </div>
          ) : null}
        </>
      )}

      {editingCharacterId !== null ? (
        <CharacterEditor
          characterId={editingCharacterId}
          onClose={() => setEditingCharacterId(null)}
          onSaved={() => {
            setEditingCharacterId(null);
            retry();
          }}
        />
      ) : null}
    </div>
  );
}
