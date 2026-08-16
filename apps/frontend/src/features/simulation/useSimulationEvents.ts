import { useCallback, useEffect, useReducer, useState } from "react";
import type { FeedThreadDto, PostDto, SseEvent } from "@brickr/shared";

import { api, isAbortError, toErrorMessage } from "../../services/api-client";
import { subscribeToSimulationEvents } from "../../services/sse-client";
import { createRefreshScheduler } from "../../services/sse-refresh";
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
  addLocalPost: (post: PostDto, thread: FeedThreadDto) => void;
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
    dispatch({ kind: "connection", connection: "connecting" });
    const refreshScheduler = createRefreshScheduler(() => {
      setReloadToken((value) => value + 1);
    });

    const handleEvent = (event: SseEvent): void => {
      if (cancelled) return;

      switch (event.type) {
        case "post.created": {
          if (event.roomId !== simulationId) return;
          refreshScheduler.schedule();
          break;
        }
        case "response.started":
          if (event.roomId !== simulationId) return;
          dispatch({
            kind: "responseStarted",
            activity: { activityId: event.activityId, targetPostId: event.targetPostId },
          });
          break;
        case "response.finished":
          if (event.roomId !== simulationId) return;
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

    return () => {
      cancelled = true;
      refreshScheduler.cancel();
      subscription.close();
    };
  }, [simulationId, enabled]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const controller = new AbortController();

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
    };
  }, [simulationId, reloadToken, enabled]);

  const addLocalPost = useCallback((post: PostDto, _thread: FeedThreadDto) => {
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
