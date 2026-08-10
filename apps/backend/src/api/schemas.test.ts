import { describe, expect, it } from "vitest";
import {
  bulkCreateCharactersSchema,
  bulkDeleteCharactersSchema,
  createPostSchema,
  saveCharacterSchema,
  saveUserProfileSchema,
  updateApplicationSettingsSchema,
} from "./schemas.js";

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

describe("avatar image validation", () => {
  const avatarUrl = "data:image/webp;base64,aGVsbG8=";

  it("accepts a cropped avatar for a user profile", () => {
    expect(
      saveUserProfileSchema.safeParse({
        displayName: "ユーザー",
        description: "プロフィール",
        avatarUrl,
      }).success,
    ).toBe(true);
  });

  it("accepts a cropped avatar for a character", () => {
    expect(
      saveCharacterSchema.safeParse({
        handle: "avatar_test",
        displayName: "Avatar Test",
        description: "プロフィール",
        rolePrompt: "立場",
        tonePrompt: "口調",
        interests: [],
        activityLevel: 0.5,
        responseProbability: 0.5,
        replyProbability: 0.5,
        quoteProbability: 0.5,
        influence: 0.5,
        modelProfileId: "test-profile",
        avatarUrl,
      }).success,
    ).toBe(true);
  });

  it("rejects SVG avatar data", () => {
    expect(
      saveUserProfileSchema.safeParse({
        displayName: "ユーザー",
        description: "",
        avatarUrl: "data:image/svg+xml;base64,PHN2Zz4=",
      }).success,
    ).toBe(false);
  });
});

describe("bulkDeleteCharactersSchema", () => {
  it("accepts one or more character ids", () => {
    expect(
      bulkDeleteCharactersSchema.safeParse({ ids: ["character-1", "character-2"] })
        .success,
    ).toBe(true);
  });

  it("rejects an empty selection", () => {
    expect(bulkDeleteCharactersSchema.safeParse({ ids: [] }).success).toBe(false);
  });
});

describe("bulkCreateCharactersSchema", () => {
  it("accepts a count from 1 through 100", () => {
    expect(bulkCreateCharactersSchema.safeParse({ count: 1 }).success).toBe(true);
    expect(bulkCreateCharactersSchema.safeParse({ count: 100 }).success).toBe(true);
  });

  it("rejects zero, fractions and more than 100", () => {
    expect(bulkCreateCharactersSchema.safeParse({ count: 0 }).success).toBe(false);
    expect(bulkCreateCharactersSchema.safeParse({ count: 1.5 }).success).toBe(false);
    expect(bulkCreateCharactersSchema.safeParse({ count: 101 }).success).toBe(false);
  });
});

describe("updateApplicationSettingsSchema", () => {
  it("accepts a partial override and a reset", () => {
    expect(
      updateApplicationSettingsSchema.safeParse({
        overrides: { MAX_CASCADE_DEPTH: "5" },
      }).success,
    ).toBe(true);
    expect(
      updateApplicationSettingsSchema.safeParse({
        overrides: { MAX_CASCADE_DEPTH: null },
      }).success,
    ).toBe(true);
  });

  it("rejects readonly and empty setting changes", () => {
    expect(
      updateApplicationSettingsSchema.safeParse({
        overrides: { OPENAI_API_KEY: "not-allowed" },
      }).success,
    ).toBe(false);
    expect(updateApplicationSettingsSchema.safeParse({ overrides: {} }).success).toBe(false);
  });
});
