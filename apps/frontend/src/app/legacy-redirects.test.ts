import { describe, expect, it } from "vitest";
import { legacyRedirectTarget } from "./legacy-redirects";

describe("legacyRedirectTarget", () => {
  it("redirects /characters to /cast", () => {
    expect(legacyRedirectTarget("/characters")).toBe("/cast");
  });

  it("redirects /simulations to /rooms", () => {
    expect(legacyRedirectTarget("/simulations")).toBe("/rooms");
  });

  it("redirects /simulations/:id/analysis to /rooms/:id/analysis, preserving the id", () => {
    expect(legacyRedirectTarget("/simulations/sim-1/analysis")).toBe("/rooms/sim-1/analysis");
  });

  it("percent-encodes an id with special characters", () => {
    expect(legacyRedirectTarget("/simulations/sim 1/analysis")).toBe(
      "/rooms/sim%201/analysis",
    );
  });

  it("returns null for a non-legacy path", () => {
    expect(legacyRedirectTarget("/rooms/abc")).toBeNull();
    expect(legacyRedirectTarget("/")).toBeNull();
    expect(legacyRedirectTarget("/architect")).toBeNull();
  });
});
