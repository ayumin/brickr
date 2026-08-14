import { useCallback, useEffect, useReducer, useState } from "react";
import type { PostDto, SseEvent } from "@brickr/shared";

import { api, isAbortError, toErrorMessage } from "../../services/api-client";
import { subscribeToSimulationEvents } from "../../services/sse-client";
import type { ConnectionState, ResponseActivity } from "../../types";
import {
  INITIAL_SIMULATION_EVENT_STATE,
  reduceSimulationEvents,
} from "./simulation-event-state";

export type UseSimulationEventsResult = {
  posts: PostDto[];
  activities: ResponseActivity[];
  failedResponses: number;
  connection: ConnectionState;
  connected: boolean;
  loading: boolean;
  error: string | null;
  /** Insert the user's own post immediately, before the stream echoes it back. */
  addLocalPost: (post: PostDto) => void;
  reload: () => void;
  dismissError: () => void;
  dismissFailures: () => void;
};

/**
 * Owns the EventSource for one simulation and reduces its events into state.
 *
 * EventSource reconnects by itself, so `onerror` only flips the UI into
 * 「再接続中」 — we never build our own retry loop (CLAUDE.md §43, §44).
 */
export function useSimulationEvents(
  simulationId: string,
  enabled: boolean = true,
): UseSimulationEventsResult {
  const [state, dispatch] = useReducer(reduceSimulationEvents, INITIAL_SIMULATION_EVENT_STATE);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    dispatch({ kind: "reset" });
  }, [simulationId]);

  useEffect(() => {
    if (!enabled) {
      dispatch({ kind: "disconnected" });
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    dispatch({ kind: "connection", connection: "connecting" });

    const handleEvent = (event: SseEvent): void => {
      if (cancelled) return;

      switch (event.type) {
        case "feed.post-created": {
          // The event carries the whole thread (§11.3). This screen shows a flat
          // timeline, so it takes the posts and lets the server keep owning the
          // counts and capabilities.
          if (event.thread.root.simulationId !== simulationId) return;
          dispatch({
            kind: "upsertPosts",
            posts: [event.thread.root, ...event.thread.latestReplies],
          });
          break;
        }
        case "response.started":
          if (event.simulationId !== simulationId) return;
          dispatch({
            kind: "responseStarted",
            activity: { activityId: event.activityId, targetPostId: event.targetPostId },
          });
          break;
        case "response.finished":
          if (event.simulationId !== simulationId) return;
          dispatch({
            kind: "responseFinished",
            activityId: event.activityId,
            failed: event.outcome === "failed",
          });
          break;
        default:
          break;
      }
    };

    // Subscribe BEFORE the REST fetch so posts generated while the history
    // request is in flight are kept (mergePosts dedupes them by id).
    const subscription = subscribeToSimulationEvents(simulationId, {
      onEvent: handleEvent,
      onOpen: () => {
        if (!cancelled) {
          dispatch({ kind: "connection", connection: "open" });
        }
      },
      onError: () => {
        if (!cancelled) {
          dispatch({ kind: "connection", connection: "reconnecting" });
        }
      },
    });

    void api
      .getPosts(simulationId, controller.signal)
      .then((posts) => {
        if (!cancelled) {
          dispatch({ kind: "hydrated", posts });
        }
      })
      .catch((error: unknown) => {
        if (cancelled || isAbortError(error)) {
          return;
        }
        dispatch({ kind: "loadFailed", message: toErrorMessage(error) });
      });

    return () => {
      cancelled = true;
      controller.abort();
      subscription.close();
    };
  }, [simulationId, reloadToken, enabled]);

  const addLocalPost = useCallback((post: PostDto) => {
    dispatch({ kind: "upsertPosts", posts: [post] });
  }, []);

  const reload = useCallback(() => {
    setReloadToken((value) => value + 1);
  }, []);

  const dismissError = useCallback(() => {
    dispatch({ kind: "dismissError" });
  }, []);

  const dismissFailures = useCallback(() => {
    dispatch({ kind: "dismissFailures" });
  }, []);

  return {
    posts: state.posts,
    activities: state.activities,
    failedResponses: state.failedResponses,
    connection: state.connection,
    connected: state.connection === "open",
    loading: state.loading,
    error: state.simulationError ?? state.loadError,
    addLocalPost,
    reload,
    dismissError,
    dismissFailures,
  };
}
