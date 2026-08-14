import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFeedFilter, writeFeedFilter } from "./feed-filter-storage";

function fakeStorage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string): string | null => entries.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      entries.set(key, value);
    },
    removeItem: (key: string): void => {
      entries.delete(key);
    },
  };
}

describe("feed filter storage", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: fakeStorage() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to all when nothing is stored", () => {
    expect(readFeedFilter()).toBe("all");
  });

  it("round-trips mine", () => {
    writeFeedFilter("mine");
    expect(readFeedFilter()).toBe("mine");
  });

  it("falls back to all for a corrupted value", () => {
    window.localStorage.setItem("brickr.feedFilter", "everything");
    expect(readFeedFilter()).toBe("all");
  });
});
