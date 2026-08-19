import { useCallback, useEffect, useReducer, useState } from "react";
import type { FeedThreadDto, PostDto, SseEvent } from "@brickr/shared";

import { api, isAbortError, toErrorMessage } from "../../services/api-client";
import { subscribeToRoomEvents } from "../../services/sse-client";
import { createRefreshScheduler } from "../../services/sse-refresh";
import type { ConnectionState, ResponseActivity } from "../../types";
import {
  INITIAL_ROOM_POSTS_STATE,
  reduceRoomPosts,
} from "./room-posts-state";

export type UseRoomPostsResult = {
  posts: PostDto[];
  activities: ResponseActivity[];
  connection: ConnectionState;
  loading: boolean;
  error: string | null;
  /** Whether the caller may reply/quote in this room right now (§10.8). */
  canPost: boolean;
  /** Insert the user's own post immediately, before the stream echoes it back. */
  addLocalPost: (post: PostDto, thread: FeedThreadDto) => void;
  reload: () => void;
};

/**
 * Loads and live-updates the flat post list for a single room.
 *
 * Used by `PostDetailScreen` (§10.8), which needs a flat `PostDto[]` for the
 * `Timeline` component rather than the thread-shaped `FeedThreadDto[]` that
 * `useFeed` provides.
 */
export function useRoomPosts(roomId: string, enabled = true): UseRoomPostsResult {
  const [state, dispatch] = useReducer(reduceRoomPosts, INITIAL_ROOM_POSTS_STATE);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    dispatch({ kind: "reset" });
  }, [roomId]);

  useEffect(() => {
    if (!enabled) {
      dispatch({ kind: "disconnected" });
      return;
    }

    let cancelled = false;
    dispatch({ kind: "connection", connection: "connecting" });
    const refreshScheduler = createRefreshScheduler(() => {
      setReloadToken((v) => v + 1);
    });

    const handleEvent = (event: SseEvent): void => {
      if (cancelled) return;
      switch (event.type) {
        case "post.created":
          if (event.roomId !== roomId) return;
          refreshScheduler.schedule();
          break;
        case "response.started":
          if (event.roomId !== roomId) return;
          dispatch({ kind: "responseStarted", activity: { activityId: event.activityId, targetPostId: event.targetPostId } });
          break;
        case "response.finished":
          if (event.roomId !== roomId) return;
          dispatch({ kind: "responseFinished", activityId: event.activityId });
          break;
        default:
          break;
      }
    };

    const subscription = subscribeToRoomEvents(roomId, {
      onEvent: handleEvent,
      onOpen: () => { if (!cancelled) dispatch({ kind: "connection", connection: "open" }); },
      onError: () => { if (!cancelled) dispatch({ kind: "connection", connection: "reconnecting" }); },
    });

    return () => {
      cancelled = true;
      refreshScheduler.cancel();
      subscription.close();
    };
  }, [roomId, enabled]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const controller = new AbortController();
    void api
      .getPosts(roomId, controller.signal)
      .then(({ posts, canPost }) => {
        if (!cancelled) dispatch({ kind: "hydrated", posts, canPost });
      })
      .catch((cause: unknown) => {
        if (cancelled || isAbortError(cause)) return;
        dispatch({ kind: "loadFailed", message: toErrorMessage(cause) });
      });
    return () => { cancelled = true; controller.abort(); };
  }, [roomId, reloadToken, enabled]);

  const addLocalPost = useCallback((post: PostDto, _thread: FeedThreadDto) => {
    dispatch({ kind: "upsertPosts", posts: [post] });
  }, []);

  const reload = useCallback(() => setReloadToken((v) => v + 1), []);

  return {
    posts: state.posts,
    activities: state.activities,
    connection: state.connection,
    loading: state.loading,
    error: state.error,
    canPost: state.canPost,
    addLocalPost,
    reload,
  };
}
