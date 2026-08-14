import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import type { FeedFilter, FeedPageDto, FeedThreadDto } from "@brickr/shared";

import { api, isAbortError, toErrorMessage } from "../../services/api-client";
import type { ConnectionState } from "../../types";
import { INITIAL_FEED_STATE, reduceFeed } from "./feed-reducer";
import { useFeedEvents, type FeedScope } from "./useFeedEvents";

export type { FeedScope } from "./useFeedEvents";

export type UseFeedResult = {
  threads: FeedThreadDto[];
  hasMore: boolean;
  loadingInitial: boolean;
  loadingMore: boolean;
  initialError: string | null;
  loadMoreError: string | null;
  connection: ConnectionState;
  activeResponseCount: number;
  generationWarning: boolean;
  loadMore: () => void;
  reload: () => void;
  /** Insert the caller's own new thread immediately, before the stream echoes it back. */
  upsertThread: (thread: FeedThreadDto) => void;
  dismissGenerationWarning: () => void;
};

function fetchPage(
  scope: FeedScope,
  filter: FeedFilter,
  cursor: string | null,
  signal: AbortSignal,
): Promise<FeedPageDto> {
  return scope.kind === "room"
    ? api.getRoomFeed(scope.roomId, filter, cursor, signal)
    : api.getFeed(filter, cursor, signal);
}

/**
 * Owns one feed's data: the unified feed, or a single room's (§10.1, §10.2).
 * Persistence (which filter to remember, which room to reopen) is the
 * caller's job (`features/rooms/{feed-filter,selected-room}-storage.ts`) -
 * this hook only reacts to whatever filter it is given.
 */
export function useFeed(scope: FeedScope, filter: FeedFilter, enabled: boolean = true): UseFeedResult {
  const [state, dispatch] = useReducer(reduceFeed, INITIAL_FEED_STATE);
  const [reloadToken, setReloadToken] = useState(0);
  const roomId = scope.kind === "room" ? scope.roomId : null;

  useEffect(() => {
    dispatch({ kind: "reset" });
  }, [roomId, filter]);

  // Subscribed before the initial fetch runs below (effects fire in the order
  // they're declared), so a thread updated while the request is in flight is
  // not lost - the same guarantee `useSimulationEvents` makes.
  useFeedEvents(scope, filter, dispatch, enabled);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const controller = new AbortController();
    dispatch({ kind: "initialLoadStarted" });

    fetchPage(scope, filter, null, controller.signal)
      .then((page) => {
        if (!cancelled) dispatch({ kind: "initialLoaded", page });
      })
      .catch((cause: unknown) => {
        if (cancelled || isAbortError(cause)) return;
        dispatch({ kind: "initialLoadFailed", message: toErrorMessage(cause) });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // `scope` itself is compared via `roomId` above; the effect always reads
    // the latest `scope` from its own render's closure.
  }, [roomId, filter, enabled, reloadToken]);

  const loadMore = useCallback(() => {
    if (!enabled || state.nextCursor === null || state.loadingMore) return;
    dispatch({ kind: "loadMoreStarted" });
    fetchPage(scope, filter, state.nextCursor, new AbortController().signal)
      .then((page) => dispatch({ kind: "loadMoreLoaded", page }))
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return;
        dispatch({ kind: "loadMoreFailed", message: toErrorMessage(cause) });
      });
  }, [roomId, filter, state.nextCursor, state.loadingMore, enabled]);

  const reload = useCallback(() => {
    setReloadToken((value) => value + 1);
  }, []);

  const upsertThread = useCallback((thread: FeedThreadDto) => {
    // Always applied regardless of `filter`: a thread this account just
    // authored always "concerns" it (§12.3), so the SSE-only mine-restriction
    // in `feed-reducer` (§4 論点2(iii)) must not suppress it here.
    dispatch({ kind: "upsertThread", thread, filter: "all" });
  }, []);

  const dismissGenerationWarning = useCallback(() => {
    dispatch({ kind: "dismissGenerationWarning" });
  }, []);

  const threads = useMemo(
    () =>
      state.orderedIds
        .map((id) => state.byId.get(id))
        .filter((thread): thread is FeedThreadDto => thread !== undefined),
    [state.orderedIds, state.byId],
  );

  return {
    threads,
    hasMore: state.nextCursor !== null,
    loadingInitial: state.loadingInitial,
    loadingMore: state.loadingMore,
    initialError: state.initialError,
    loadMoreError: state.loadMoreError,
    connection: state.connection,
    activeResponseCount: state.activeResponses.size,
    generationWarning: state.generationWarning,
    loadMore,
    reload,
    upsertThread,
    dismissGenerationWarning,
  };
}
