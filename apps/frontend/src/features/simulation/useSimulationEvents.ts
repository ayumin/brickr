import { useCallback, useEffect, useReducer, useState } from "react";
import type { PostDto, SseEvent } from "@brickr/shared";

import { api, isAbortError, toErrorMessage } from "../../services/api-client";
import { subscribeToSimulationEvents } from "../../services/sse-client";
import type {
  CharacterFailure,
  ConnectionState,
  ThinkingCharacter,
} from "../../types";

const MAX_VISIBLE_FAILURES = 4;

type State = {
  posts: PostDto[];
  thinking: ThinkingCharacter[];
  failures: CharacterFailure[];
  connection: ConnectionState;
  loading: boolean;
  loadError: string | null;
  simulationError: string | null;
};

const INITIAL_STATE: State = {
  posts: [],
  thinking: [],
  failures: [],
  connection: "connecting",
  loading: true,
  loadError: null,
  simulationError: null,
};

type Action =
  | { kind: "reset" }
  | { kind: "hydrated"; posts: PostDto[] }
  | { kind: "loadFailed"; message: string }
  | { kind: "upsertPost"; post: PostDto }
  | { kind: "processing"; character: ThinkingCharacter }
  | { kind: "characterSkipped"; characterId: string }
  | { kind: "characterFailed"; characterId: string; reason: string }
  | { kind: "completed" }
  | { kind: "simulationFailed"; reason: string }
  | { kind: "connection"; connection: ConnectionState }
  | { kind: "disconnected" }
  | { kind: "dismissError" }
  | { kind: "dismissFailures" };

/** Chronological order; ids break ties so equal timestamps stay stable. */
function comparePosts(a: PostDto, b: PostDto): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? -1 : 1;
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
}

/**
 * Merge posts by id.
 *
 * Used for both the REST hydration and every SSE `post.created`, which is what
 * makes the two sources race-safe: whichever arrives first wins the slot, the
 * other one just overwrites the same id instead of duplicating it.
 */
function mergePosts(existing: PostDto[], incoming: PostDto[]): PostDto[] {
  if (incoming.length === 0) {
    return existing;
  }

  const byId = new Map<string, PostDto>();
  for (const post of existing) {
    byId.set(post.id, post);
  }

  let changed = false;
  for (const post of incoming) {
    changed = true;
    byId.set(post.id, post);
  }

  if (!changed && byId.size === existing.length) {
    return existing;
  }

  return [...byId.values()].sort(comparePosts);
}

function withoutCharacter(
  thinking: ThinkingCharacter[],
  characterId: string,
): ThinkingCharacter[] {
  const next = thinking.filter((entry) => entry.characterId !== characterId);
  return next.length === thinking.length ? thinking : next;
}

function reducer(state: State, action: Action): State {
  switch (action.kind) {
    case "reset":
      return INITIAL_STATE;

    case "hydrated":
      return {
        ...state,
        // Merge, don't replace: SSE posts may already be in state.
        posts: mergePosts(state.posts, action.posts),
        loading: false,
        loadError: null,
      };

    case "loadFailed":
      return { ...state, loading: false, loadError: action.message };

    case "upsertPost": {
      const author = action.post.author;
      return {
        ...state,
        posts: mergePosts(state.posts, [action.post]),
        thinking:
          author.kind === "character"
            ? withoutCharacter(state.thinking, author.id)
            : state.thinking,
      };
    }

    case "processing": {
      if (
        state.thinking.some(
          (entry) =>
            entry.characterId === action.character.characterId &&
            entry.targetPostId === action.character.targetPostId,
        )
      ) {
        return state;
      }
      return { ...state, thinking: [...state.thinking, action.character] };
    }

    case "characterSkipped":
      return {
        ...state,
        thinking: withoutCharacter(state.thinking, action.characterId),
      };

    case "characterFailed": {
      const known = state.thinking.find(
        (entry) => entry.characterId === action.characterId,
      );
      const failure: CharacterFailure = {
        characterId: action.characterId,
        label: known ? `@${known.handle}` : action.characterId,
        reason: action.reason,
      };
      return {
        ...state,
        thinking: withoutCharacter(state.thinking, action.characterId),
        failures: [...state.failures, failure].slice(-MAX_VISIBLE_FAILURES),
      };
    }

    case "completed":
      // Every responder for that round is done, so no indicator should linger.
      return state.thinking.length === 0 ? state : { ...state, thinking: [] };

    case "simulationFailed":
      return { ...state, thinking: [], simulationError: action.reason };

    case "connection":
      return state.connection === action.connection
        ? state
        : { ...state, connection: action.connection };

    case "disconnected":
      return { ...state, connection: "disconnected", thinking: [] };

    case "dismissError":
      return { ...state, loadError: null, simulationError: null };

    case "dismissFailures":
      return state.failures.length === 0 ? state : { ...state, failures: [] };

    default:
      return state;
  }
}

export type UseSimulationEventsResult = {
  posts: PostDto[];
  thinking: ThinkingCharacter[];
  failures: CharacterFailure[];
  connection: ConnectionState;
  connected: boolean;
  loading: boolean;
  error: string | null;
  /** Insert the user's own post immediately, before SSE echoes it back. */
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
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
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
      if (cancelled || event.simulationId !== simulationId) {
        return;
      }

      switch (event.type) {
        case "post.created":
          dispatch({ kind: "upsertPost", post: event.post });
          break;
        case "character.processing":
          dispatch({
            kind: "processing",
            character: {
              targetPostId: event.targetPostId,
              characterId: event.characterId,
              handle: event.handle,
              displayName: event.displayName,
            },
          });
          break;
        case "character.skipped":
          dispatch({ kind: "characterSkipped", characterId: event.characterId });
          break;
        case "character.failed":
          dispatch({
            kind: "characterFailed",
            characterId: event.characterId,
            reason: event.reason,
          });
          break;
        case "simulation.completed":
          dispatch({ kind: "completed" });
          break;
        case "simulation.failed":
          dispatch({ kind: "simulationFailed", reason: event.reason });
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
    dispatch({ kind: "upsertPost", post });
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
    thinking: state.thinking,
    failures: state.failures,
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
