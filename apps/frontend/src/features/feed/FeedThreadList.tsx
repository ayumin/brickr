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
  onReply?: (post: PostDto) => void;
  onRepost?: (post: PostDto) => void;
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
 * down the page mid-read. Every commit re-measures and corrects rather than
 * only reacting to a `threads` prop change, so the fix applies uniformly
 * regardless of why the list re-rendered.
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

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const topAfterByThreadId = measureThreadTops(container);

    const delta = computeScrollCorrection({
      anchor: anchorRef.current,
      topAfterByThreadId,
      scrollY: window.scrollY,
    });

    if (delta !== 0) {
      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollBy({ top: delta, behavior: resolveScrollBehavior(prefersReducedMotion) });
    }

    anchorRef.current = captureScrollAnchor(
      [...topAfterByThreadId.entries()].map(([threadId, top]) => ({ threadId, top })),
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
            {...(onReply ? { onReply } : {})}
            {...(onRepost ? { onRepost } : {})}
          />
        </li>
      ))}
    </ul>
  );
}
