/**
 * State the simulation stream reduces into, kept free of React so the rules that
 * matter can be tested directly (§24.3).
 */
import type { PostDto } from "@brickr/shared";

import type { ConnectionState, ResponseActivity } from "../../types";

export type SimulationEventState = {
  posts: PostDto[];
  /** Responses in flight, keyed by activity: anonymous, so only the count means anything. */
  activities: ResponseActivity[];
  /** How many responses failed. Never why, and never whose (§11.2). */
  failedResponses: number;
  connection: ConnectionState;
  loading: boolean;
  loadError: string | null;
  simulationError: string | null;
};

export const INITIAL_SIMULATION_EVENT_STATE: SimulationEventState = {
  posts: [],
  activities: [],
  failedResponses: 0,
  connection: "connecting",
  loading: true,
  loadError: null,
  simulationError: null,
};

export type SimulationEventAction =
  | { kind: "reset" }
  | { kind: "hydrated"; posts: PostDto[] }
  | { kind: "loadFailed"; message: string }
  | { kind: "upsertPosts"; posts: PostDto[] }
  | { kind: "responseStarted"; activity: ResponseActivity }
  | { kind: "responseFinished"; activityId: string; failed: boolean }
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
 * Used for both the REST hydration and every posted event, which is what makes
 * the two sources race-safe: whichever arrives first wins the slot, the other one
 * just overwrites the same id instead of duplicating it.
 */
function mergePosts(existing: PostDto[], incoming: PostDto[]): PostDto[] {
  if (incoming.length === 0) {
    return existing;
  }

  const byId = new Map<string, PostDto>();
  for (const post of existing) {
    byId.set(post.id, post);
  }
  for (const post of incoming) {
    byId.set(post.id, post);
  }

  return [...byId.values()].sort(comparePosts);
}

export function reduceSimulationEvents(
  state: SimulationEventState,
  action: SimulationEventAction,
): SimulationEventState {
  switch (action.kind) {
    case "reset":
      return INITIAL_SIMULATION_EVENT_STATE;

    case "hydrated":
      return {
        ...state,
        // Merge, don't replace: streamed posts may already be in state.
        posts: mergePosts(state.posts, action.posts),
        loading: false,
        loadError: null,
      };

    case "loadFailed":
      return { ...state, loading: false, loadError: action.message };

    case "upsertPosts":
      return { ...state, posts: mergePosts(state.posts, action.posts) };

    case "responseStarted": {
      if (state.activities.some((entry) => entry.activityId === action.activity.activityId)) {
        return state;
      }
      return { ...state, activities: [...state.activities, action.activity] };
    }

    case "responseFinished": {
      const activities = state.activities.filter(
        (entry) => entry.activityId !== action.activityId,
      );
      if (activities.length === state.activities.length && !action.failed) {
        return state;
      }
      return {
        ...state,
        activities,
        failedResponses: action.failed ? state.failedResponses + 1 : state.failedResponses,
      };
    }

    case "connection":
      return state.connection === action.connection
        ? state
        : { ...state, connection: action.connection };

    case "disconnected":
      // Nothing can finish while disconnected, so in-flight activities would
      // otherwise linger as indicators that never resolve.
      return { ...state, connection: "disconnected", activities: [] };

    case "dismissError":
      return { ...state, loadError: null, simulationError: null };

    case "dismissFailures":
      return state.failedResponses === 0 ? state : { ...state, failedResponses: 0 };

    default:
      return state;
  }
}
