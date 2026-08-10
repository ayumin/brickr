import { describe, expect, it } from "vitest";
import { runWithConcurrency } from "./concurrency.js";

type Settled<T, R> = { item: T; value: R } | { item: T; error: unknown };

function isValue<T, R>(entry: Settled<T, R>): entry is { item: T; value: R } {
  return "value" in entry;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("runWithConcurrency", () => {
  it("returns results in input order even when workers finish out of order", async () => {
    const items = [1, 2, 3, 4, 5] as const;

    // Later items finish first, so completion order is the reverse of input order.
    const results = await runWithConcurrency(items, items.length, async (item) => {
      await delay((items.length - item) * 5);
      return item * 10;
    });

    expect(results.map((entry) => entry.item)).toEqual([1, 2, 3, 4, 5]);
    expect(results.every(isValue)).toBe(true);
    expect(results.filter(isValue).map((entry) => entry.value)).toEqual([10, 20, 30, 40, 50]);
  });

  it("reports a throwing worker as an error entry while the others still return values", async () => {
    const items = ["architect", "skeptic", "kansai"] as const;
    const failure = new Error("skeptic timeout");

    const results = await runWithConcurrency(items, 2, async (item) => {
      if (item === "skeptic") throw failure;
      return `${item} generated`;
    });

    expect(results).toHaveLength(3);

    const [first, second, third] = results;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(third).toBeDefined();

    expect(first && isValue(first) ? first.value : null).toBe("architect generated");
    expect(third && isValue(third) ? third.value : null).toBe("kansai generated");

    expect(second && isValue(second)).toBe(false);
    expect(second).toEqual({ item: "skeptic", error: failure });
  });

  it("never rejects even when every worker throws", async () => {
    const results = await runWithConcurrency([1, 2, 3], 3, async (item) => {
      throw new Error(`boom ${item}`);
    });

    expect(results).toHaveLength(3);
    expect(results.some(isValue)).toBe(false);
  });

  it("keeps the number of in-flight workers at or below the limit", async () => {
    const items = Array.from({ length: 12 }, (_unused, index) => index);
    const limit = 3;

    let inFlight = 0;
    let peak = 0;

    await runWithConcurrency(items, limit, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await delay(2);
      inFlight -= 1;
    });

    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(limit);
    expect(inFlight).toBe(0);
  });

  it("keeps the limit even when some workers throw", async () => {
    const items = Array.from({ length: 10 }, (_unused, index) => index);
    const limit = 2;

    let inFlight = 0;
    let peak = 0;

    await runWithConcurrency(items, limit, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      try {
        await delay(1);
        if (item % 2 === 0) throw new Error(`boom ${item}`);
        return item;
      } finally {
        inFlight -= 1;
      }
    });

    expect(peak).toBeLessThanOrEqual(limit);
    expect(inFlight).toBe(0);
  });

  it("returns an empty array for an empty input without hanging", async () => {
    let called = false;

    const results = await runWithConcurrency([], 4, async () => {
      called = true;
      return 1;
    });

    expect(results).toEqual([]);
    expect(called).toBe(false);
  });

  it("handles a limit larger than the number of items", async () => {
    const results = await runWithConcurrency([1, 2], 100, async (item) => item + 1);

    expect(results.filter(isValue).map((entry) => entry.value)).toEqual([2, 3]);
  });

  it("processes every item exactly once", async () => {
    const items = Array.from({ length: 20 }, (_unused, index) => index);
    const seen: number[] = [];

    const results = await runWithConcurrency(items, 4, async (item, index) => {
      seen.push(item);
      return index;
    });

    expect([...seen].sort((a, b) => a - b)).toEqual(items);
    expect(results.filter(isValue).map((entry) => entry.value)).toEqual(items);
  });
});
