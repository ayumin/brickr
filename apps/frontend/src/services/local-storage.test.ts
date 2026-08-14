import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STORAGE_KEYS,
  clearStored,
  readStored,
  readStoredOneOf,
  writeStored,
} from "./local-storage";

/**
 * These tests run in the frontend's node environment, so `window` is faked rather
 * than provided by jsdom: a Map is a faithful stand-in for the only three storage
 * methods this module uses, and it keeps the test suite free of a DOM dependency
 * it needs nowhere else.
 *
 * What is being verified is the wrapping, not the browser. Storage *throws* when a
 * browser blocks it (private modes, Safari with cookies disabled) instead of
 * returning null, and a blocked preference has to cost the preference and nothing
 * else — never an exception a screen has to handle.
 */
function fakeStorage(options: { throws?: boolean } = {}) {
  const entries = new Map<string, string>();
  const guard = (): void => {
    if (options.throws) throw new Error("storage is blocked");
  };

  return {
    entries,
    localStorage: {
      getItem: (key: string): string | null => {
        guard();
        return entries.get(key) ?? null;
      },
      setItem: (key: string, value: string): void => {
        guard();
        entries.set(key, value);
      },
      removeItem: (key: string): void => {
        guard();
        entries.delete(key);
      },
    },
  };
}

describe("local storage helpers", () => {
  let storage: ReturnType<typeof fakeStorage>;

  beforeEach(() => {
    storage = fakeStorage();
    vi.stubGlobal("window", { localStorage: storage.localStorage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps every key in one registry, namespaced to the app", () => {
    expect(Object.values(STORAGE_KEYS)).toEqual([
      "brickr.theme",
      "brickr.selectedSimulationId",
      "brickr.feedFilter",
    ]);
  });

  it("round-trips a value and clears it", () => {
    writeStored(STORAGE_KEYS.selectedSimulationId, "room-1");
    expect(readStored(STORAGE_KEYS.selectedSimulationId)).toBe("room-1");

    clearStored(STORAGE_KEYS.selectedSimulationId);
    expect(readStored(STORAGE_KEYS.selectedSimulationId)).toBeNull();
  });

  it("treats a value outside the allowed set as absent", () => {
    writeStored(STORAGE_KEYS.feedFilter, "everything");
    expect(readStoredOneOf(STORAGE_KEYS.feedFilter, ["all", "mine"] as const)).toBeNull();

    writeStored(STORAGE_KEYS.feedFilter, "mine");
    expect(readStoredOneOf(STORAGE_KEYS.feedFilter, ["all", "mine"] as const)).toBe("mine");
  });

  describe("when the browser blocks storage", () => {
    beforeEach(() => {
      vi.stubGlobal("window", { localStorage: fakeStorage({ throws: true }).localStorage });
    });

    it("reads as absent instead of throwing", () => {
      expect(readStored(STORAGE_KEYS.theme)).toBeNull();
      expect(readStoredOneOf(STORAGE_KEYS.theme, ["brickr-dark"] as const)).toBeNull();
    });

    it("swallows a write and a removal", () => {
      expect(() => writeStored(STORAGE_KEYS.theme, "brickr-dark")).not.toThrow();
      expect(() => clearStored(STORAGE_KEYS.theme)).not.toThrow();
    });
  });
});
