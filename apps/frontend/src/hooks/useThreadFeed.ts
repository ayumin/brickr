/**
 * Common state layer for thread feeds (§10.1, §10.2, Issue #167).
 *
 * `useThreadFeed` is the single hook that owns fetch, cursor pagination,
 * deduplication, SSE-driven REST re-sync, reconnection state, and the
 * scroll-anchor contract — regardless of whether the caller is the unified
 * feed (`kind: 'all'`) or a single room (`kind: 'room'`).
 *
 * It is a thin, stable public surface over `useFeed` so that:
 *   - `FeedScreen` and `RoomScreen` share identical data-fetching semantics
 *     without duplicating the SSE/refresh/pagination wiring.
 *   - The hook's signature matches the `ThreadFeedSource` union from
 *     `@brickr/shared`, making the call site self-documenting.
 *   - Tests can import `useThreadFeed` directly without knowing about the
 *     internal `useFeed` split.
 *
 * Scroll-position maintenance is a layout concern handled by `FeedThreadList`
 * via `feed-scroll-anchor.ts`; this hook exposes the `threads` array whose
 * identity changes trigger that correction.
 */
import type { FeedFilter, ThreadFeedSource } from "@brickr/shared";

import { useFeed, type UseFeedResult } from "../features/feed/useFeed";

export type { UseFeedResult as UseThreadFeedResult };

/**
 * Owns one thread feed's data for either the unified feed or a single room.
 *
 * @param source  `{ kind: 'all' }` for the global feed, or
 *                `{ kind: 'room'; roomId: string }` for a room-scoped feed.
 * @param filter  `'all'` (every thread) or `'mine'` (threads that concern me).
 * @param enabled When `false` the SSE subscription is closed and no fetches
 *                are issued — used by `RoomScreen` to pause the stream while
 *                the user has manually disconnected.
 */
export function useThreadFeed(
  source: ThreadFeedSource,
  filter: FeedFilter,
  enabled: boolean = true,
): UseFeedResult {
  return useFeed(source, filter, enabled);
}
