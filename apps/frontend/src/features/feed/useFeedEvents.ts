import { useEffect } from "react";
import type { Dispatch } from "react";
import type { SseEvent, ThreadFeedSource } from "@brickr/shared";

import { subscribeToFeedEvents, subscribeToSimulationEvents } from "../../services/sse-client";
import { createRefreshScheduler } from "../../services/sse-refresh";
import type { FeedAction } from "./feed-reducer";

/**
 * Owns the EventSource behind one feed scope and dispatches its events into
 * `feed-reducer`. EventSource reconnects by itself, so `onerror` only flips
 * the UI into 「再接続中」 — never a hand-rolled retry (CLAUDE.md §43, §44).
 */
export function useFeedEvents(
  source: ThreadFeedSource,
  dispatch: Dispatch<FeedAction>,
  enabled: boolean,
  onInvalidate: () => void,
): void {
  const roomId = source.kind === "room" ? source.roomId : null;

  useEffect(() => {
    if (!enabled) {
      dispatch({ kind: "disconnected" });
      return;
    }

    dispatch({ kind: "connection", connection: "connecting" });
    const refreshScheduler = createRefreshScheduler(onInvalidate);

    // A room-scoped feed accepts only notifications for its room. The all-room
    // feed accepts every notification delivered by its visibility-filtered stream.
    const matchesScope = (eventRoomId: string): boolean =>
      roomId === null || eventRoomId === roomId;

    const handleEvent = (event: SseEvent): void => {
      switch (event.type) {
        case "post.created":
          if (event.roomId === null || !matchesScope(event.roomId)) return;
          refreshScheduler.schedule();
          break;
        case "response.started":
          if (event.roomId === null) return;
          if (!matchesScope(event.roomId)) return;
          dispatch({ kind: "responseStarted", activityId: event.activityId });
          break;
        case "response.finished":
          if (event.roomId === null) return;
          if (!matchesScope(event.roomId)) return;
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

    const handlers = {
      onEvent: handleEvent,
      onOpen: () => dispatch({ kind: "connection", connection: "open" }),
      onError: () => dispatch({ kind: "connection", connection: "reconnecting" }),
    };

    const subscription =
      roomId !== null ? subscribeToSimulationEvents(roomId, handlers) : subscribeToFeedEvents(handlers);

    return () => {
      refreshScheduler.cancel();
      subscription.close();
    };
  }, [roomId, dispatch, enabled, onInvalidate]);
}
