import type { PostDto } from "@brickr/shared";

import type { ConnectionState, ResponseActivity } from "../../types";

export type RoomPostsState = {
  posts: PostDto[];
  activities: ResponseActivity[];
  connection: ConnectionState;
  loading: boolean;
  error: string | null;
  /**
   * Whether the caller may reply/quote in this room right now (§10.8).
   *
   * Server-computed, from the same `GET /api/rooms/:id/posts` response that
   * hydrates `posts` — not derived from a separate room fetch, which 404s for
   * the reserved Feed room and would wrongly disable every action here.
   */
  canPost: boolean;
};

export const INITIAL_ROOM_POSTS_STATE: RoomPostsState = {
  posts: [],
  activities: [],
  connection: "connecting",
  loading: true,
  error: null,
  canPost: false,
};

export type RoomPostsAction =
  | { kind: "reset" }
  | { kind: "hydrated"; posts: PostDto[]; canPost: boolean }
  | { kind: "loadFailed"; message: string }
  | { kind: "upsertPosts"; posts: PostDto[] }
  | { kind: "responseStarted"; activity: ResponseActivity }
  | { kind: "responseFinished"; activityId: string }
  | { kind: "connection"; connection: ConnectionState }
  | { kind: "disconnected" };

export function compareRoomPosts(a: PostDto, b: PostDto): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function mergeRoomPosts(existing: PostDto[], incoming: PostDto[]): PostDto[] {
  if (incoming.length === 0) return existing;
  const byId = new Map<string, PostDto>();
  for (const post of existing) byId.set(post.id, post);
  for (const post of incoming) byId.set(post.id, post);
  return [...byId.values()].sort(compareRoomPosts);
}

export function reduceRoomPosts(state: RoomPostsState, action: RoomPostsAction): RoomPostsState {
  switch (action.kind) {
    case "reset":
      return INITIAL_ROOM_POSTS_STATE;
    case "hydrated":
      return {
        ...state,
        posts: mergeRoomPosts(state.posts, action.posts),
        loading: false,
        error: null,
        canPost: action.canPost,
      };
    case "loadFailed":
      return { ...state, loading: false, error: action.message };
    case "upsertPosts":
      return { ...state, posts: mergeRoomPosts(state.posts, action.posts) };
    case "responseStarted":
      if (state.activities.some((activity) => activity.activityId === action.activity.activityId)) {
        return state;
      }
      return { ...state, activities: [...state.activities, action.activity] };
    case "responseFinished":
      return {
        ...state,
        activities: state.activities.filter(
          (activity) => activity.activityId !== action.activityId,
        ),
      };
    case "connection":
      return state.connection === action.connection
        ? state
        : { ...state, connection: action.connection };
    case "disconnected":
      return { ...state, connection: "disconnected", activities: [] };
    default:
      return state;
  }
}
