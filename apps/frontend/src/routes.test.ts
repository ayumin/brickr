import { describe, expect, it } from "vitest";
import {
  characterListPath,
  handlePath,
  matchRoute,
  postPath,
  simulationAnalysisPath,
  simulationListPath,
  usersManagementPath,
} from "./routes";

describe("matchRoute", () => {
  it("matches the home route", () => {
    expect(matchRoute("/")).toEqual({ kind: "home" });
  });

  it("matches the static list routes", () => {
    expect(matchRoute("/characters")).toEqual({ kind: "characters" });
    expect(matchRoute("/simulations")).toEqual({ kind: "simulations" });
  });

  it("matches a simulation analysis route", () => {
    expect(matchRoute("/simulations/sim-1/analysis")).toEqual({
      kind: "simulation-analysis",
      simulationId: "sim-1",
    });
  });

  it("matches a post route", () => {
    expect(matchRoute("/posts/post-1")).toEqual({ kind: "post", postId: "post-1" });
  });

  it("matches the admin users-management route, nested under the reserved 'admin' segment", () => {
    expect(matchRoute("/admin/users")).toEqual({ kind: "users-management" });
    // The bare reserved segment itself is still not a route.
    expect(matchRoute("/admin")).toEqual({ kind: "not-found" });
  });

  it("matches a well-formed handle", () => {
    expect(matchRoute("/architect")).toEqual({ kind: "handle", handle: "architect" });
  });

  it("normalizes case and a leading @ the same way the backend's handleParams does", () => {
    // What a user actually copies out of a timeline: `@Architect`, mixed case,
    // or both. All of these must resolve identically to the plain handle.
    expect(matchRoute("/Architect")).toEqual({ kind: "handle", handle: "architect" });
    expect(matchRoute("/@architect")).toEqual({ kind: "handle", handle: "architect" });
    expect(matchRoute("/@Architect")).toEqual({ kind: "handle", handle: "architect" });
  });

  it("still rejects a reserved word after normalization, not just its exact-case form", () => {
    expect(matchRoute("/LOGIN")).toEqual({ kind: "not-found" });
    expect(matchRoute("/@Login")).toEqual({ kind: "not-found" });
  });

  it("rejects a handle shorter than the 3-character minimum", () => {
    expect(matchRoute("/ab")).toEqual({ kind: "not-found" });
  });

  it("rejects a reserved handle so it never resolves as a profile", () => {
    expect(matchRoute("/login")).toEqual({ kind: "not-found" });
    expect(matchRoute("/admin")).toEqual({ kind: "not-found" });
  });

  it("rejects the app's own top-level routes as handles", () => {
    // These are real segments this MR introduces above the `/:handle`
    // catch-all; without reserving them, a character or user could claim one
    // and make it permanently unreachable.
    expect(matchRoute("/characters")).not.toEqual({ kind: "handle", handle: "characters" });
    expect(matchRoute("/simulations")).not.toEqual({ kind: "handle", handle: "simulations" });
    expect(matchRoute("/posts")).toEqual({ kind: "not-found" });
  });

  it("reports an unmatched multi-segment path as not-found", () => {
    expect(matchRoute("/foo/bar/baz")).toEqual({ kind: "not-found" });
  });
});

describe("path builders", () => {
  it("build the paths matchRoute recognizes", () => {
    expect(characterListPath()).toBe("/characters");
    expect(simulationListPath()).toBe("/simulations");
    expect(simulationAnalysisPath("sim-1")).toBe("/simulations/sim-1/analysis");
    expect(postPath("post-1")).toBe("/posts/post-1");
    expect(handlePath("architect")).toBe("/architect");
    expect(usersManagementPath()).toBe("/admin/users");
  });

  it("percent-encode ids and handles that need it", () => {
    expect(postPath("post 1")).toBe("/posts/post%201");
    expect(handlePath("weird/handle")).toBe("/weird%2Fhandle");
  });
});
