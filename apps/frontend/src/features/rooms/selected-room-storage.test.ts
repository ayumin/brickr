import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSelectedRoomId,
  readSelectedRoomId,
  writeSelectedRoomId,
} from "./selected-room-storage";

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

describe("selected room storage", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: fakeStorage() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is null when nothing was ever stored", () => {
    expect(readSelectedRoomId()).toBeNull();
  });

  it("round-trips a room id and clears it", () => {
    writeSelectedRoomId("room-1");
    expect(readSelectedRoomId()).toBe("room-1");

    clearSelectedRoomId();
    expect(readSelectedRoomId()).toBeNull();
  });
});
