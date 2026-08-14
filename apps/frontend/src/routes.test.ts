import { describe, expect, it } from "vitest";
import {
  castPath,
  handlePath,
  normalizeHandleParam,
  postPath,
  roomAnalysisPath,
  roomListPath,
  roomPath,
  settingsPath,
} from "./routes";

describe("normalizeHandleParam", () => {
  it("normalizes a well-formed handle", () => {
    expect(normalizeHandleParam("architect")).toBe("architect");
  });

  it("normalizes case and a leading @ the same way the backend's handleParams does", () => {
    // What a user actually copies out of a timeline: `@Architect`, mixed case,
    // or both. All of these must resolve identically to the plain handle.
    expect(normalizeHandleParam("Architect")).toBe("architect");
    expect(normalizeHandleParam("@architect")).toBe("architect");
    expect(normalizeHandleParam("@Architect")).toBe("architect");
  });

  it("rejects a reserved word after normalization, not just its exact-case form", () => {
    expect(normalizeHandleParam("LOGIN")).toBeNull();
    expect(normalizeHandleParam("@Login")).toBeNull();
  });

  it("rejects a handle shorter than the 3-character minimum", () => {
    expect(normalizeHandleParam("ab")).toBeNull();
  });

  it("rejects every reserved word this app now routes above the /:handle catch-all", () => {
    for (const reserved of ["login", "admin", "characters", "simulations", "rooms", "cast", "settings", "posts"]) {
      expect(normalizeHandleParam(reserved)).toBeNull();
    }
  });

  it("rejects undefined and an empty string", () => {
    expect(normalizeHandleParam(undefined)).toBeNull();
    expect(normalizeHandleParam("")).toBeNull();
  });
});

describe("path builders", () => {
  it("build the expected paths", () => {
    expect(postPath("post-1")).toBe("/posts/post-1");
    expect(handlePath("architect")).toBe("/architect");
    expect(roomListPath()).toBe("/rooms");
    expect(roomPath("room-1")).toBe("/rooms/room-1");
    expect(roomAnalysisPath("room-1")).toBe("/rooms/room-1/analysis");
    expect(castPath()).toBe("/cast");
    expect(settingsPath("profile")).toBe("/settings/profile");
  });

  it("percent-encode ids and handles that need it", () => {
    expect(postPath("post 1")).toBe("/posts/post%201");
    expect(handlePath("weird/handle")).toBe("/weird%2Fhandle");
    expect(roomPath("room 1")).toBe("/rooms/room%201");
    expect(roomAnalysisPath("room 1")).toBe("/rooms/room%201/analysis");
  });
});
