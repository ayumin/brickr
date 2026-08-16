import { useEffect } from "react";
import type { Dispatch } from "react";
import type { FeedFilter, SseEvent } from "@brickr/shared";

import { subscribeToFeedEvents, subscribeToSimulationEvents } from "../../services/sse-client";
import type { FeedAction } from "./feed-reducer";

/** What a feed hydrates from: the unified feed, or one room's own feed (§10.1, §10.2). */
export type FeedScope = { kind: "global" } | { kind: "room"; roomId: string };

/**
 * Owns the EventSource behind one feed scope and dispatches its events into
 * `feed-reducer`. EventSource reconnects by itself, so `onerror` only flips
 * the UI into 「再接続中」 — never a hand-rolled retry (CLAUDE.md §43, §44).
 */
export function useFeedEvents(
  scope: FeedScope,
  filter: FeedFilter,
  dispatch: Dispatch<FeedAction>,
  enabled: boolean,
): void {
  const roomId = scope.kind === "room" ? scope.roomId : null;

  useEffect(() => {
    if (!enabled) {
      dispatch({ kind: "disconnected" });
      return;
    }

    dispatch({ kind: "connection", connection: "connecting" });

    // A room-scoped feed reuses the room's own event stream, which carries
    // every simulation's events (§11.1) - so it must filter to this room the
    // same way `useSimulationEvents` does.
    const matchesScope = (eventSimulationId: string): boolean =>
      roomId === null || eventSimulationId === roomId;

    const handleEvent = (event: SseEvent): void => {
      switch (event.type) {
        case "feed.post-created":
          if (!matchesScope(event.thread.root.roomId)) return;
          dispatch({ kind: "upsertThread", thread: event.thread, filter });
          break;
        case "response.started":
          if (!matchesScope(event.roomId)) return;
          dispatch({ kind: "responseStarted", activityId: event.activityId });
          break;
        case "response.finished":
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

    return () => subscription.close();
  }, [roomId, filter, dispatch, enabled]);
}
