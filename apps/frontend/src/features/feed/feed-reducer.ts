/**
 * State the unified feed reduces into, kept free of React so dedupe/sort rules
 * can be tested directly (mirrors `features/simulation/simulation-event-state.ts`).
 */
import type { FeedFilter, FeedPageDto, FeedThreadDto } from "@brickr/shared";

import type { ConnectionState } from "../../types";

export type FeedState = {
  byId: Map<string, FeedThreadDto>;
  orderedIds: string[];
  nextCursor: string | null;
  loadingInitial: boolean;
  loadingMore: boolean;
  connection: ConnectionState;
  /** activityIds in flight. Anonymous by design (§11.3): only the count means anything. */
  activeResponses: Set<string>;
  generationWarning: boolean;
  initialError: string | null;
  loadMoreError: string | null;
};

export const INITIAL_FEED_STATE: FeedState = {
  byId: new Map(),
  orderedIds: [],
  nextCursor: null,
  loadingInitial: true,
  loadingMore: false,
  connection: "connecting",
  activeResponses: new Set(),
  generationWarning: false,
  initialError: null,
  loadMoreError: null,
};

export type FeedAction =
  | { kind: "reset" }
  | { kind: "initialLoadStarted" }
  | { kind: "initialLoaded"; page: FeedPageDto }
  | { kind: "initialLoadFailed"; message: string }
  | { kind: "loadMoreStarted" }
  | { kind: "loadMoreLoaded"; page: FeedPageDto }
  | { kind: "loadMoreFailed"; message: string }
  | { kind: "upsertThread"; thread: FeedThreadDto; filter: FeedFilter }
  | { kind: "responseStarted"; activityId: string }
  | { kind: "responseFinished"; activityId: string; failed: boolean }
  | { kind: "connection"; connection: ConnectionState }
  | { kind: "disconnected" }
  | { kind: "dismissGenerationWarning" };

/**
 * `lastActivityAt` DESC; `root.id` DESC breaks ties so two threads that moved
 * in the same SSE tick (or share a page boundary) still sort deterministically
 * (§12.1 — the same reason Step 2 made the feed cursor a compound key).
 */
function compareThreads(a: FeedThreadDto, b: FeedThreadDto): number {
  if (a.lastActivityAt !== b.lastActivityAt) {
    return a.lastActivityAt > b.lastActivityAt ? -1 : 1;
  }
  if (a.root.id === b.root.id) {
    return 0;
  }
  return a.root.id > b.root.id ? -1 : 1;
}

function sortedIds(byId: Map<string, FeedThreadDto>): string[] {
  return [...byId.values()].sort(compareThreads).map((thread) => thread.root.id);
}

export function reduceFeed(state: FeedState, action: FeedAction): FeedState {
  switch (action.kind) {
    case "reset":
      return INITIAL_FEED_STATE;

    case "initialLoadStarted":
      return { ...state, loadingInitial: true, initialError: null };

    case "initialLoaded": {
      // A fresh page replaces the list outright — this is what makes a filter
      // switch or an explicit reload start from a known-clean state instead of
      // merging stale threads from a different query.
      const byId = new Map(action.page.threads.map((thread) => [thread.root.id, thread]));
      return {
        ...state,
        byId,
        orderedIds: sortedIds(byId),
        nextCursor: action.page.nextCursor,
        loadingInitial: false,
        initialError: null,
      };
    }

    case "initialLoadFailed":
      return { ...state, loadingInitial: false, initialError: action.message };

    case "loadMoreStarted":
      return { ...state, loadingMore: true, loadMoreError: null };

    case "loadMoreLoaded": {
      // Dedupe by root id and append only the unseen ones. Deliberately not
      // re-sorted: a later page is, by construction, older activity than
      // everything already loaded, so appending preserves cursor ordering. An
      // upsert re-sorts the whole list instead — see that action below.
      const byId = new Map(state.byId);
      const appended: string[] = [];
      for (const thread of action.page.threads) {
        if (byId.has(thread.root.id)) continue;
        byId.set(thread.root.id, thread);
        appended.push(thread.root.id);
      }
      return {
        ...state,
        byId,
        orderedIds: [...state.orderedIds, ...appended],
        nextCursor: action.page.nextCursor,
        loadingMore: false,
        loadMoreError: null,
      };
    }

    case "loadMoreFailed":
      return { ...state, loadingMore: false, loadMoreError: action.message };

    case "upsertThread": {
      // §4 論点2(iii): `mine`'s membership test is server-side logic the
      // client cannot replicate, so a thread not already loaded is never
      // inserted under that filter — only an already-loaded thread's own
      // update (new reply, updated counts) is safe to apply.
      const isNew = !state.byId.has(action.thread.root.id);
      if (action.filter === "mine" && isNew) {
        return state;
      }
      const byId = new Map(state.byId);
      byId.set(action.thread.root.id, action.thread);
      return { ...state, byId, orderedIds: sortedIds(byId) };
    }

    case "responseStarted": {
      if (state.activeResponses.has(action.activityId)) {
        return state;
      }
      const activeResponses = new Set(state.activeResponses);
      activeResponses.add(action.activityId);
      return { ...state, activeResponses };
    }

    case "responseFinished": {
      if (!state.activeResponses.has(action.activityId)) {
        return action.failed && !state.generationWarning
          ? { ...state, generationWarning: true }
          : state;
      }
      const activeResponses = new Set(state.activeResponses);
      activeResponses.delete(action.activityId);
      return {
        ...state,
        activeResponses,
        generationWarning: state.generationWarning || action.failed,
      };
    }

    case "connection":
      return state.connection === action.connection
        ? state
        : { ...state, connection: action.connection };

    case "disconnected":
      // Nothing can finish while disconnected, so in-flight activities would
      // otherwise linger as indicators that never resolve (mirrors
      // simulation-event-state.ts's identical rule).
      return { ...state, connection: "disconnected", activeResponses: new Set() };

    case "dismissGenerationWarning":
      return state.generationWarning ? { ...state, generationWarning: false } : state;

    default:
      return state;
  }
}
