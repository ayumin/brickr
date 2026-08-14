import { describe, expect, it } from "vitest";

import {
  DEFAULT_NEAR_TOP_THRESHOLD_PX,
  captureScrollAnchor,
  computeScrollCorrection,
  computeScrollCorrectionDelta,
  resolveScrollBehavior,
  type ThreadTopOffset,
} from "./feed-scroll-anchor";

describe("captureScrollAnchor", () => {
  it("returns null when nothing is rendered", () => {
    expect(captureScrollAnchor([])).toBeNull();
  });

  it("picks the thread whose top is closest to the viewport top", () => {
    const offsets: ThreadTopOffset[] = [
      { threadId: "far-above", top: -400 },
      { threadId: "closest", top: 12 },
      { threadId: "below", top: 300 },
    ];

    expect(captureScrollAnchor(offsets)).toEqual({ threadId: "closest", top: 12 });
  });

  it("prefers the thread already scrolled past (top <= 0) on an exact tie", () => {
    const offsets: ThreadTopOffset[] = [
      { threadId: "below", top: 20 },
      { threadId: "above", top: -20 },
    ];

    expect(captureScrollAnchor(offsets)).toEqual({ threadId: "above", top: -20 });
  });

  it("returns the only offset when there is exactly one thread", () => {
    const offsets: ThreadTopOffset[] = [{ threadId: "only", top: -1000 }];
    expect(captureScrollAnchor(offsets)).toEqual({ threadId: "only", top: -1000 });
  });
});

describe("computeScrollCorrectionDelta", () => {
  it("is 0 when there is no anchor", () => {
    expect(computeScrollCorrectionDelta(null, new Map([["a", 50]]))).toBe(0);
  });

  it("is 0 when the anchor thread is no longer rendered", () => {
    const anchor = { threadId: "gone", top: 100 };
    expect(computeScrollCorrectionDelta(anchor, new Map([["other", 10]]))).toBe(0);
  });

  it("is the new top minus the old top when a thread moved down", () => {
    // A new thread landed above it, pushing it further from the viewport top.
    const anchor = { threadId: "reader-is-here", top: 120 };
    const topAfter = new Map([["reader-is-here", 280]]);

    expect(computeScrollCorrectionDelta(anchor, topAfter)).toBe(160);
  });

  it("is negative when a thread moved up", () => {
    const anchor = { threadId: "reader-is-here", top: 200 };
    const topAfter = new Map([["reader-is-here", 50]]);

    expect(computeScrollCorrectionDelta(anchor, topAfter)).toBe(-150);
  });

  it("is 0 for a tail-only append: the anchor's own offset never moved", () => {
    // "load more" adds threads after everything already on screen, so a
    // thread nearer the top keeps the exact same offset - no special case
    // needed, the subtraction alone comes back to 0.
    const anchor = { threadId: "reader-is-here", top: 140 };
    const topAfter = new Map([
      ["reader-is-here", 140],
      ["newly-appended", 900],
    ]);

    expect(computeScrollCorrectionDelta(anchor, topAfter)).toBe(0);
  });
});

describe("computeScrollCorrection", () => {
  const anchor = { threadId: "reader-is-here", top: 120 };
  const topAfter = new Map([["reader-is-here", 300]]);

  it("delegates to the delta calculation away from the top of the page", () => {
    const delta = computeScrollCorrection({
      anchor,
      topAfterByThreadId: topAfter,
      scrollY: DEFAULT_NEAR_TOP_THRESHOLD_PX + 1,
    });

    expect(delta).toBe(180);
  });

  it("skips correction when the reader is at the very top", () => {
    const delta = computeScrollCorrection({
      anchor,
      topAfterByThreadId: topAfter,
      scrollY: 0,
    });

    expect(delta).toBe(0);
  });

  it("skips correction exactly at the near-top threshold", () => {
    const delta = computeScrollCorrection({
      anchor,
      topAfterByThreadId: topAfter,
      scrollY: DEFAULT_NEAR_TOP_THRESHOLD_PX,
    });

    expect(delta).toBe(0);
  });

  it("honors a custom near-top threshold", () => {
    const delta = computeScrollCorrection({
      anchor,
      topAfterByThreadId: topAfter,
      scrollY: 500,
      nearTopThresholdPx: 1000,
    });

    expect(delta).toBe(0);
  });
});

describe("resolveScrollBehavior", () => {
  it("uses smooth scrolling by default", () => {
    expect(resolveScrollBehavior(false)).toBe("smooth");
  });

  it("falls back to an instant jump under prefers-reduced-motion", () => {
    expect(resolveScrollBehavior(true)).toBe("auto");
  });
});
