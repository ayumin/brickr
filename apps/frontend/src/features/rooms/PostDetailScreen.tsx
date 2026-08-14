import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PostDto } from "@brickr/shared";

import { ErrorBanner } from "../../components/ErrorBanner";
import { Spinner } from "../../components/Spinner";
import { handlePath } from "../../routes";
import {
  api,
  ApiError,
  isAbortError,
  isForbiddenError,
  isUnauthorizedError,
  toErrorMessage,
} from "../../services/api-client";
import { useCharacters } from "../../hooks/useCharacters";
import { useUserProfile } from "../../hooks/useUserProfile";
import { PostDetail } from "../timeline/PostDetail";
import { useSimulationEvents } from "../simulation/useSimulationEvents";

type PostState =
  | { status: "loading" }
  | { status: "denied" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "ready"; post: PostDto };

/**
 * The post detail route (§6.1, §10.8) - login required, not tied to any
 * particular room the way RoomScreen is, and unmounted like any other
 * `<Route>` screen (§13.5) rather than kept alive across navigations.
 *
 * `GET /api/posts/:id` is the actual access-control authority (a stopped
 * room's post detail 404s for anyone but its creator/admin) - this screen
 * only has to interpret the response, then load the rest of that post's
 * room to render replies and reposts around it.
 */
export function PostDetailScreen({ postId }: { postId: string }) {
  const navigate = useNavigate();
  const [state, setState] = useState<PostState>({ status: "loading" });
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    api
      .getPost(postId, controller.signal)
      .then((post) => setState({ status: "ready", post }))
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return;
        if (isUnauthorizedError(cause) || isForbiddenError(cause)) {
          setState({ status: "denied" });
          return;
        }
        if (cause instanceof ApiError && cause.isNotFound) {
          setState({ status: "not-found" });
          return;
        }
        setState({ status: "error", message: toErrorMessage(cause) });
      });
    return () => controller.abort();
  }, [postId, retryToken]);

  useEffect(() => {
    if (state.status === "denied") navigate("/", { replace: true });
  }, [state.status, navigate]);

  const simulationId = state.status === "ready" ? state.post.simulationId : null;

  const { characters } = useCharacters();
  const userProfile = useUserProfile();
  const events = useSimulationEvents(simulationId ?? "", simulationId !== null);

  // Whether the room is stopped, fetched separately from the post itself:
  // a stopped room's post detail still opens for its creator/admin (§10.8),
  // but posting/replying/quoting stays refused for everyone regardless (§19.3).
  const [canPost, setCanPost] = useState(true);
  useEffect(() => {
    if (simulationId === null) return;
    const controller = new AbortController();
    api
      .getSimulation(simulationId, controller.signal)
      .then(({ simulation }) => setCanPost(simulation.status !== "stopped"))
      .catch((cause: unknown) => {
        if (!isAbortError(cause)) setCanPost(false);
      });
    return () => controller.abort();
  }, [simulationId]);

  const openAuthor = useCallback(
    (authorId: string) => {
      if (authorId === userProfile.profile.id) {
        navigate(handlePath(userProfile.profile.handle));
        return;
      }
      const character = characters.find((item) => item.id === authorId);
      const handle = character?.handle ?? events.posts.find((post) => post.author.id === authorId)?.author.handle;
      if (handle) navigate(handlePath(handle));
    },
    [navigate, characters, events.posts, userProfile.profile.id, userProfile.profile.handle],
  );

  const openPost = useCallback(
    (id: string) => navigate(`/posts/${encodeURIComponent(id)}`),
    [navigate],
  );

  if (state.status === "loading" || state.status === "denied") {
    return (
      <div className="flex items-center justify-center px-4 py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  if (state.status === "not-found") {
    return (
      <div className="px-4 py-12">
        <ErrorBanner
          message="投稿が見つかりませんでした"
          detail="投稿が削除されたか、閲覧できない可能性があります。"
          onRetry={() => navigate("/")}
          retryLabel="ホームへ戻る"
        />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="px-4 py-12">
        <ErrorBanner
          message="投稿を取得できませんでした"
          detail={state.message}
          onRetry={() => setRetryToken((value) => value + 1)}
        />
      </div>
    );
  }

  // The post fetched at mount is kept fresh by the room's own live post list
  // once it hydrates, the same way RoomScreen reads its posts.
  const post = events.posts.find((item) => item.id === state.post.id) ?? state.post;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <PostDetail
        simulationId={post.simulationId}
        post={post}
        allPosts={events.posts}
        characters={characters}
        userProfile={userProfile.profile}
        activities={events.activities}
        canPost={canPost}
        onOpenAuthor={openAuthor}
        onOpenPost={openPost}
        onPosted={events.addLocalPost}
      />
    </div>
  );
}
