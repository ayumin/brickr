import { afterEach, describe, expect, it, vi } from "vitest";
import { createRefreshScheduler } from "./sse-refresh";

afterEach(() => {
  vi.useRealTimers();
});

describe("createRefreshScheduler", () => {
  it("coalesces a notification burst into one refresh", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const scheduler = createRefreshScheduler(refresh, 100);

    scheduler.schedule();
    vi.advanceTimersByTime(50);
    scheduler.schedule();
    vi.advanceTimersByTime(50);
    scheduler.schedule();

    vi.advanceTimersByTime(99);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending refresh during effect cleanup", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const scheduler = createRefreshScheduler(refresh, 100);

    scheduler.schedule();
    scheduler.cancel();
    vi.runAllTimers();

    expect(refresh).not.toHaveBeenCalled();
  });
});
