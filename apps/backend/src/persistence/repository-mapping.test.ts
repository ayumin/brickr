import { describe, expect, it } from "vitest";
import { optionalField } from "./repository-mapping.js";

describe("optionalField", () => {
  it("includes the key when the value is truthy", () => {
    expect(optionalField("avatarUrl", "https://example.com/a.png")).toEqual({
      avatarUrl: "https://example.com/a.png",
    });
  });

  it.each([null, undefined, ""])("omits the key entirely for %p", (value) => {
    expect(optionalField("avatarUrl", value)).toEqual({});
    expect(optionalField("avatarUrl", value)).not.toHaveProperty("avatarUrl");
  });
});
