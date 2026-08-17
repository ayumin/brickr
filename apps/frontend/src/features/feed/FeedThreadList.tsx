import { useLayoutEffect, useRef } from "react";
import type { FeedThreadDto, PostDto } from "@brickr/shared";

import { FeedThreadCard } from "./FeedThreadCard";
import { captureScrollAnchor, computeScrollCorrection, resolveScrollBehavior, type ScrollAnchor } from "./feed-scroll-anchor";

export type FeedThreadListProps = {
  threads: FeedThreadDto[];
  currentUserId?: string;
  /** Handles we recognise (characters + the user), for mention highlighting. */
  knownHandles?: ReadonlySet<string>;
  onOpenAuthor?: (authorId: string) => void;
  onOpenHandle?: (handle: string) => void;
  onOpenThread?: (postId: string) => void;
  /** Required so write capabilities can never silently lose their UI handlers. */
  onReply: (post: PostDto) => void;
  onRepost: (post: PostDto) => void;
};

function measureThreadTops(container: HTMLElement): Map<string, number> {
  const tops = new Map<string, number>();
  for (const element of container.querySelectorAll<HTMLElement>("[data-thread-id]")) {
    const threadId = element.dataset.threadId;
    if (threadId) {
      tops.set(threadId, element.getBoundingClientRect().top);
    }
  }
  return tops;
}

/**
 * Renders every thread, shared by the unified feed and by a single room's own
 * feed (§10.2: "並び・ページング・返信プレビューは統合フィードと同じ").
 *
 * Also owns the scroll-position correction across a reorder (§12.4, ★重要):
 * a reply landing on some other thread moves it to the top of the list,
 * which would otherwise push whatever the reader is currently looking at
 * down the page mid-read.
 *
 * The effect still runs on every commit (no dependency array), but only
 * *corrects* when `threads` itself changed since the last run - it always
 * refreshes `anchorRef` either way. A commit triggered by something else
 * (e.g. `loadingMore` flipping true the instant "さらに読み込む" is clicked,
 * before the next page has even arrived) must not scroll against whatever
 * position the anchor was captured at several renders ago: if the reader
 * scrolled manually since then with no re-render in between, that anchor is
 * stale, and correcting against it snaps the page back to that old spot.
 * `threads` itself is reference-stable across a `loadingMore`-only state
 * change (`useFeed`'s `useMemo` only depends on `state.orderedIds`/`byId`,
 * neither of which that action touches), so comparing it here is a reliable
 * "did the rendered content actually change" check.
 */
export function FeedThreadList({
  threads,
  currentUserId,
  knownHandles,
  onOpenAuthor,
  onOpenHandle,
  onOpenThread,
  onReply,
  onRepost,
}: FeedThreadListProps) {
  const containerRef = useRef<HTMLUListElement | null>(null);
  const anchorRef = useRef<ScrollAnchor | null>(null);
  const previousThreadsRef = useRef<FeedThreadDto[] | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const topAfterByThreadId = measureThreadTops(container);
    const threadsChanged = previousThreadsRef.current !== threads;
    previousThreadsRef.current = threads;

    if (!threadsChanged) {
      anchorRef.current = captureScrollAnchor(
        [...topAfterByThreadId.entries()].map(([threadId, top]) => ({ threadId, top })),
      );
      return;
    }

    const delta = computeScrollCorrection({
      anchor: anchorRef.current,
      topAfterByThreadId,
      scrollY: window.scrollY,
    });

    if (delta !== 0) {
      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollBy({ top: delta, behavior: resolveScrollBehavior(prefersReducedMotion) });
    }

    // A `scrollBy` shifts every viewport-relative top by `-delta`, so the
    // anchor must reflect that before storing it - otherwise the very next
    // commit computes a delta that exactly reverses this correction.
    const topAfterCorrectionByThreadId =
      delta === 0
        ? topAfterByThreadId
        : new Map([...topAfterByThreadId].map(([id, top]) => [id, top - delta]));

    anchorRef.current = captureScrollAnchor(
      [...topAfterCorrectionByThreadId.entries()].map(([threadId, top]) => ({ threadId, top })),
    );
  });

  return (
    <ul ref={containerRef}>
      {threads.map((thread) => (
        <li key={thread.root.id}>
          <FeedThreadCard
            thread={thread}
            {...(currentUserId ? { currentUserId } : {})}
            {...(knownHandles ? { knownHandles } : {})}
            {...(onOpenAuthor ? { onOpenAuthor } : {})}
            {...(onOpenHandle ? { onOpenHandle } : {})}
            {...(onOpenThread ? { onOpenThread } : {})}
            onReply={onReply}
            onRepost={onRepost}
          />
        </li>
      ))}
    </ul>
  );
}
