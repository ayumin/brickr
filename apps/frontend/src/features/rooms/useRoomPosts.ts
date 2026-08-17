import { useCallback, useEffect, useReducer, useState } from "react";
import type { FeedThreadDto, PostDto, SseEvent } from "@brickr/shared";

import { api, isAbortError, toErrorMessage } from "../../services/api-client";
import { subscribeToSimulationEvents } from "../../services/sse-client";
import { createRefreshScheduler } from "../../services/sse-refresh";
import type { ConnectionState, ResponseActivity } from "../../types";

type RoomPostsState = {
  posts: PostDto[];
  activities: ResponseActivity[];
  connection: ConnectionState;
  loading: boolean;
  error: string | null;
};

const INITIAL_STATE: RoomPostsState = {
  posts: [],
  activities: [],
  connection: "connecting",
  loading: true,
  error: null,
};

type RoomPostsAction =
  | { kind: "reset" }
  | { kind: "hydrated"; posts: PostDto[] }
  | { kind: "loadFailed"; message: string }
  | { kind: "upsertPosts"; posts: PostDto[] }
  | { kind: "responseStarted"; activity: ResponseActivity }
  | { kind: "responseFinished"; activityId: string }
  | { kind: "connection"; connection: ConnectionState }
  | { kind: "disconnected" };

function comparePosts(a: PostDto, b: PostDto): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function mergePosts(existing: PostDto[], incoming: PostDto[]): PostDto[] {
  if (incoming.length === 0) return existing;
  const byId = new Map<string, PostDto>();
  for (const post of existing) byId.set(post.id, post);
  for (const post of incoming) byId.set(post.id, post);
  return [...byId.values()].sort(comparePosts);
}

function reduce(state: RoomPostsState, action: RoomPostsAction): RoomPostsState {
  switch (action.kind) {
    case "reset":
      return INITIAL_STATE;
    case "hydrated":
      return { ...state, posts: mergePosts(state.posts, action.posts), loading: false, error: null };
    case "loadFailed":
      return { ...state, loading: false, error: action.message };
    case "upsertPosts":
      return { ...state, posts: mergePosts(state.posts, action.posts) };
    case "responseStarted":
      if (state.activities.some((a) => a.activityId === action.activity.activityId)) return state;
      return { ...state, activities: [...state.activities, action.activity] };
    case "responseFinished":
      return { ...state, activities: state.activities.filter((a) => a.activityId !== action.activityId) };
    case "connection":
      return state.connection === action.connection ? state : { ...state, connection: action.connection };
    case "disconnected":
      return { ...state, connection: "disconnected", activities: [] };
    default:
      return state;
  }
}

export type UseRoomPostsResult = {
  posts: PostDto[];
  activities: ResponseActivity[];
  connection: ConnectionState;
  loading: boolean;
  error: string | null;
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
  const [state, dispatch] = useReducer(reduce, INITIAL_STATE);
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

    const subscription = subscribeToSimulationEvents(roomId, {
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
      .then((posts) => { if (!cancelled) dispatch({ kind: "hydrated", posts }); })
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

  return { posts: state.posts, activities: state.activities, connection: state.connection, loading: state.loading, error: state.error, addLocalPost, reload };
}
