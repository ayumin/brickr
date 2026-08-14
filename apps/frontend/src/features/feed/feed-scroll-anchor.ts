/**
 * Pure math behind the feed's scroll-position correction (§12.4, ★重要).
 *
 * The feed reorders threads whenever one gets a new reply (newest activity
 * first). Without correction, a thread appearing above the one a reader is
 * currently looking at pushes their reading position down, and the page
 * visibly jumps. The fix: before the reorder, find the thread nearest the
 * viewport's top edge and remember its offset; after the DOM updates, look up
 * that same thread's new offset and scroll by the difference so it stays in
 * the same visual spot.
 *
 * Kept free of `window`/`document` so the decision logic is testable without a
 * DOM: the caller (a future `useLayoutEffect` in the feed's list component,
 * Step 7-7) is responsible for all the actual measuring and scrolling, using
 * only the functions here to decide what to do with what it measured.
 */

/** One thread's vertical offset, in viewport-relative pixels (`getBoundingClientRect().top`). */
export type ThreadTopOffset = {
  threadId: string;
  top: number;
};

/** The thread offset a correction will be computed against once the DOM updates. */
export type ScrollAnchor = {
  threadId: string;
  top: number;
};

/** Below this scroll distance from the document top, a reorder is never corrected (§12.4). */
export const DEFAULT_NEAR_TOP_THRESHOLD_PX = 80;

/**
 * The thread whose top edge sits closest to the viewport's top (offset 0),
 * among the threads currently rendered - this is what "the thread the reader
 * is looking at" means here. `null` when nothing is rendered.
 *
 * On an exact tie, prefers an offset at or above the top (`top <= 0`, i.e.
 * already scrolled past) over one still below it: that thread is the one
 * whose content is presently filling the top of the viewport, while a thread
 * below has not been reached yet.
 */
export function captureScrollAnchor(offsets: readonly ThreadTopOffset[]): ScrollAnchor | null {
  let best: ThreadTopOffset | null = null;
  let bestDistance = Infinity;

  for (const offset of offsets) {
    const distance = Math.abs(offset.top);
    if (
      best === null ||
      distance < bestDistance ||
      (distance === bestDistance && offset.top <= 0 && best.top > 0)
    ) {
      best = offset;
      bestDistance = distance;
    }
  }

  return best === null ? null : { threadId: best.threadId, top: best.top };
}

/**
 * How far to `window.scrollBy` so the anchor thread's top offset is restored
 * to what it was before the reorder. `0` means "do not scroll":
 *
 * - there was no anchor (nothing was rendered yet), or
 * - the anchor thread is no longer rendered (rare - e.g. a filter change
 *   dropped it), so there is nothing to correct against.
 */
export function computeScrollCorrectionDelta(
  anchor: ScrollAnchor | null,
  topAfterByThreadId: ReadonlyMap<string, number>,
): number {
  if (anchor === null) {
    return 0;
  }
  const newTop = topAfterByThreadId.get(anchor.threadId);
  if (newTop === undefined) {
    return 0;
  }
  return newTop - anchor.top;
}

export type ScrollCorrectionInput = {
  anchor: ScrollAnchor | null;
  topAfterByThreadId: ReadonlyMap<string, number>;
  /** `window.scrollY` (or the scrolling element's `scrollTop`) at the time of the reorder. */
  scrollY: number;
  nearTopThresholdPx?: number;
};

/**
 * The full decision for one reorder: how far to `window.scrollBy`, folding in
 * the "near the top" exception.
 *
 * Skipping correction near the top is deliberate (§12.4): a reader who is
 * already at the top of the feed wants to see the new thread that just
 * arrived there, not have the page hold its position and hide it.
 *
 * A tail-only change (e.g. "load more" appending older threads) needs no
 * special case: it never moves an already-rendered thread's offset, so the
 * anchor's `topAfterByThreadId` lookup naturally comes back unchanged and
 * this returns `0` on its own.
 */
export function computeScrollCorrection(input: ScrollCorrectionInput): number {
  const threshold = input.nearTopThresholdPx ?? DEFAULT_NEAR_TOP_THRESHOLD_PX;
  if (input.scrollY <= threshold) {
    return 0;
  }
  return computeScrollCorrectionDelta(input.anchor, input.topAfterByThreadId);
}

/** `prefers-reduced-motion` must never get a smooth-scrolled correction (§12.4). */
export function resolveScrollBehavior(prefersReducedMotion: boolean): ScrollBehavior {
  return prefersReducedMotion ? "auto" : "smooth";
}
