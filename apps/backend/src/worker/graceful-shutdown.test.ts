import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForCurrentWork } from "./graceful-shutdown.js";

afterEach(() => vi.useRealTimers());

describe("waitForCurrentWork", () => {
  it("waits for in-flight work to settle", async () => {
    let finish: (() => void) | undefined;
    const work = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const waiting = waitForCurrentWork(work, 10_000);

    let settled = false;
    void waiting.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    finish?.();
    await expect(waiting).resolves.toBe(true);
  });

  it("stops waiting when the grace period elapses", async () => {
    vi.useFakeTimers();
    const work = new Promise<void>(() => undefined);
    const waiting = waitForCurrentWork(work, 10_000);

    await vi.advanceTimersByTimeAsync(10_000);

    await expect(waiting).resolves.toBe(false);
  });
});
