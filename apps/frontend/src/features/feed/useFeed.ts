import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type {
  FeedFilter,
  FeedPageDto,
  FeedThreadDto,
  ThreadFeedSource,
} from "@brickr/shared";

import { api, isAbortError, toErrorMessage } from "../../services/api-client";
import type { ConnectionState } from "../../types";
import { INITIAL_FEED_STATE, reduceFeed } from "./feed-reducer";
import { useFeedEvents } from "./useFeedEvents";

export type FeedScope = ThreadFeedSource;

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
  scope: ThreadFeedSource,
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
export function useFeed(
  scope: ThreadFeedSource,
  filter: FeedFilter,
  enabled: boolean = true,
): UseFeedResult {
  const [state, dispatch] = useReducer(reduceFeed, INITIAL_FEED_STATE);
  const [reloadToken, setReloadToken] = useState(0);
  const roomId = scope.kind === "room" ? scope.roomId : null;

  // Tracks the room/filter pair that is currently "active". Updated in the
  // same effect that resets state so that any in-flight loadMore request
  // dispatched against the previous scope can detect it is stale.
  const loadMoreScopeRef = useRef<{ roomId: string | null; filter: FeedFilter }>({
    roomId,
    filter,
  });

  useEffect(() => {
    loadMoreScopeRef.current = { roomId, filter };
    dispatch({ kind: "reset" });
  }, [roomId, filter]);

  const reload = useCallback(() => {
    setReloadToken((value) => value + 1);
  }, []);

  // Subscribed before the initial fetch runs below (effects fire in the order
  // they're declared), so a thread updated while the request is in flight is
  // not lost - the same guarantee `useSimulationEvents` makes.
  useFeedEvents(scope, dispatch, enabled, reload);

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
    // Snapshot the scope at the moment the request is fired so we can detect
    // a stale response if roomId/filter changes before the promise settles.
    const requestedRoomId = roomId;
    const requestedFilter = filter;
    const controller = new AbortController();
    fetchPage(scope, filter, state.nextCursor, controller.signal)
      .then((page) => {
        const current = loadMoreScopeRef.current;
        if (current.roomId !== requestedRoomId || current.filter !== requestedFilter) return;
        dispatch({ kind: "loadMoreLoaded", page });
      })
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return;
        const current = loadMoreScopeRef.current;
        if (current.roomId !== requestedRoomId || current.filter !== requestedFilter) return;
        dispatch({ kind: "loadMoreFailed", message: toErrorMessage(cause) });
      });
  }, [roomId, filter, state.nextCursor, state.loadingMore, enabled]);

  const upsertThread = useCallback((thread: FeedThreadDto) => {
    // Pass the active filter so the reducer's mine-guard (§4 論点2(iii)) can
    // reject a brand-new thread that doesn't satisfy the current scope.
    dispatch({ kind: "upsertThread", thread, filter });
  }, [filter]);

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
