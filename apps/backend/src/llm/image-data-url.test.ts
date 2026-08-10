import { describe, expect, it } from "vitest";
import { parseImageDataUrl } from "./image-data-url.js";

describe("parseImageDataUrl", () => {
  it("separates a supported data URL into its media type and base64 payload", () => {
    expect(parseImageDataUrl("data:image/png;base64,aGVsbG8="))
      .toEqual({ mediaType: "image/png", data: "aGVsbG8=" });
  });

  it("rejects unsupported and malformed image sources", () => {
    expect(parseImageDataUrl("https://example.com/image.png")).toBeNull();
    expect(parseImageDataUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBeNull();
  });
});
