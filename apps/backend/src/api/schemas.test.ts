import { describe, expect, it } from "vitest";
import { createPostSchema } from "./schemas.js";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

describe("createPostSchema image attachment", () => {
  it("accepts an image on a top-level post", () => {
    expect(
      createPostSchema.safeParse({ content: "画像付き投稿", imageUrl: PNG_DATA_URL }).success,
    ).toBe(true);
  });

  it("accepts an image-only top-level post", () => {
    expect(createPostSchema.safeParse({ content: "", imageUrl: PNG_DATA_URL }).success).toBe(
      true,
    );
  });

  it("rejects an image on a reply", () => {
    expect(
      createPostSchema.safeParse({
        content: "reply",
        imageUrl: PNG_DATA_URL,
        replyTo: "post-1",
      }).success,
    ).toBe(false);
  });

  it("rejects an image on a quote", () => {
    expect(
      createPostSchema.safeParse({
        content: "quote",
        imageUrl: PNG_DATA_URL,
        quoteOf: "post-1",
      }).success,
    ).toBe(false);
  });

  it("rejects unsupported image data", () => {
    expect(
      createPostSchema.safeParse({
        content: "svg",
        imageUrl: "data:image/svg+xml;base64,PHN2Zz4=",
      }).success,
    ).toBe(false);
  });

  it("rejects a post with neither text nor an image", () => {
    expect(createPostSchema.safeParse({ content: "" }).success).toBe(false);
  });
});
