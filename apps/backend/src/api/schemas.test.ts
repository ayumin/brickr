import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@brickr/shared";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  bulkCreateCharactersSchema,
  bulkDeleteCharactersSchema,
  createPostSchema,
  createSimulationSchema,
  handleParams,
  loginSchema,
  saveCharacterSchema,
  saveUserProfileSchema,
  signupSchema,
  updateApplicationSettingsSchema,
  updateSimulationSchema,
} from "./schemas.js";

const VALID_CHARACTER: z.input<typeof saveCharacterSchema> = {
  handle: "valid_handle",
  displayName: "Valid",
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
};

const VALID_SIGNUP: z.input<typeof signupSchema> = {
  inviteCode: "invite-1",
  email: "person@example.com",
  password: "a".repeat(12),
  handle: "valid_handle",
  displayName: "Valid",
  birthdate: "2000-01-01",
};

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

describe("simulation title validation", () => {
  it("accepts a non-empty name and trims it", () => {
    expect(createSimulationSchema.parse({ title: "  議論  " }).title).toBe("議論");
    expect(updateSimulationSchema.parse({ title: "  過去の議論  " }).title).toBe(
      "過去の議論",
    );
  });

  it("rejects an empty or overlong name when renaming", () => {
    expect(updateSimulationSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(updateSimulationSchema.safeParse({ title: "a".repeat(121) }).success).toBe(false);
  });
});

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

describe("handle validation (CLAUDE.md §66.2, §66.13)", () => {
  it("accepts a 3-character handle, the new minimum", () => {
    expect(saveCharacterSchema.safeParse({ ...VALID_CHARACTER, handle: "ceo" }).success).toBe(
      true,
    );
    expect(signupSchema.safeParse({ ...VALID_SIGNUP, handle: "ceo" }).success).toBe(true);
  });

  it("rejects a handle shorter than 3 characters", () => {
    expect(saveCharacterSchema.safeParse({ ...VALID_CHARACTER, handle: "ab" }).success).toBe(
      false,
    );
    expect(signupSchema.safeParse({ ...VALID_SIGNUP, handle: "ab" }).success).toBe(false);
  });

  it("rejects a reserved handle for both characters and signup", () => {
    expect(saveCharacterSchema.safeParse({ ...VALID_CHARACTER, handle: "login" }).success).toBe(
      false,
    );
    expect(signupSchema.safeParse({ ...VALID_SIGNUP, handle: "admin" }).success).toBe(false);
  });

  it("resolves a 3-character handle but rejects one below the minimum", () => {
    expect(handleParams.safeParse({ handle: "ceo" }).success).toBe(true);
    expect(handleParams.safeParse({ handle: "ab" }).success).toBe(false);
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

// ---------------------------------------------------------------------------
// signupSchema
// ---------------------------------------------------------------------------

/** Minimal valid signup payload; individual fields are overridden per test. */
function validSignup(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    inviteCode: "INVITE-1",
    email: "hanako@example.com",
    password: "a".repeat(MIN_PASSWORD_LENGTH),
    handle: "hanako",
    displayName: "花子",
    birthdate: "1990-04-05",
    ...overrides,
  };
}

describe("signupSchema – handle", () => {
  it("accepts a valid lowercase-alphanumeric handle", () => {
    expect(signupSchema.safeParse(validSignup({ handle: "hanako_01" })).success).toBe(true);
  });

  it("trims surrounding whitespace and lowercases the handle", () => {
    const result = signupSchema.safeParse(validSignup({ handle: "  Hanako  " }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.handle).toBe("hanako");
  });

  it.each([
    ["hyphens", "han-ako"],
    ["spaces", "han ako"],
    ["empty string", ""],
    ["33 characters", "a".repeat(33)],
  ])("rejects a handle with %s", (_label, handle) => {
    expect(signupSchema.safeParse(validSignup({ handle })).success).toBe(false);
  });

  it("accepts a handle of exactly 32 characters", () => {
    expect(signupSchema.safeParse(validSignup({ handle: "a".repeat(32) })).success).toBe(true);
  });
});

describe("signupSchema – email", () => {
  it("accepts a valid email and normalises it to lowercase", () => {
    const result = signupSchema.safeParse(validSignup({ email: "  Hanako@Example.COM  " }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("hanako@example.com");
  });

  it("rejects a malformed email", () => {
    expect(signupSchema.safeParse(validSignup({ email: "not-an-email" })).success).toBe(false);
  });

  it("rejects an email longer than 254 characters", () => {
    const local = "a".repeat(244);
    expect(
      signupSchema.safeParse(validSignup({ email: `${local}@example.com` })).success,
    ).toBe(false);
  });

  it("accepts an email of exactly 254 characters", () => {
    // local(248) + '@'(1) + 'b.com'(5) = 254
    const local = "a".repeat(248);
    expect(
      signupSchema.safeParse(validSignup({ email: `${local}@b.com` })).success,
    ).toBe(true);
  });
});

describe("signupSchema – password", () => {
  it("accepts a password at the minimum length", () => {
    expect(
      signupSchema.safeParse(validSignup({ password: "a".repeat(MIN_PASSWORD_LENGTH) })).success,
    ).toBe(true);
  });

  it("accepts a password at the maximum length", () => {
    expect(
      signupSchema.safeParse(validSignup({ password: "a".repeat(MAX_PASSWORD_LENGTH) })).success,
    ).toBe(true);
  });

  it("rejects a password shorter than the minimum", () => {
    expect(
      signupSchema.safeParse(validSignup({ password: "a".repeat(MIN_PASSWORD_LENGTH - 1) }))
        .success,
    ).toBe(false);
  });

  it("rejects a password longer than the maximum", () => {
    expect(
      signupSchema.safeParse(validSignup({ password: "a".repeat(MAX_PASSWORD_LENGTH + 1) }))
        .success,
    ).toBe(false);
  });
});

describe("signupSchema – birthdate", () => {
  it("accepts a YYYY-MM-DD date string", () => {
    expect(signupSchema.safeParse(validSignup({ birthdate: "1990-04-05" })).success).toBe(true);
  });

  it.each([
    ["DD/MM/YYYY", "05/04/1990"],
    ["no separators", "19900405"],
    ["ISO datetime", "1990-04-05T00:00:00Z"],
    ["empty string", ""],
  ])("rejects birthdate in format %s", (_label, birthdate) => {
    expect(signupSchema.safeParse(validSignup({ birthdate })).success).toBe(false);
  });
});

describe("signupSchema – xHandle", () => {
  it("is optional and may be omitted", () => {
    const payload = validSignup();
    delete payload["xHandle"];
    expect(signupSchema.safeParse(payload).success).toBe(true);
  });

  it("strips a leading @ sign", () => {
    const result = signupSchema.safeParse(validSignup({ xHandle: "@architect" }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.xHandle).toBe("architect");
  });

  it("accepts a handle without a leading @", () => {
    const result = signupSchema.safeParse(validSignup({ xHandle: "architect" }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.xHandle).toBe("architect");
  });

  it.each([
    ["too long (16 chars)", "a".repeat(16)],
    ["contains a space", "arch itect"],
    ["contains a hyphen", "arch-itect"],
    ["empty string after stripping @", "@"],
  ])("rejects xHandle that is %s", (_label, xHandle) => {
    expect(signupSchema.safeParse(validSignup({ xHandle })).success).toBe(false);
  });

  it("accepts a handle of exactly 15 characters", () => {
    expect(signupSchema.safeParse(validSignup({ xHandle: "a".repeat(15) })).success).toBe(true);
  });
});

describe("signupSchema – optional profile fields", () => {
  it.each([
    ["description", "description", 280],
    ["country", "country", 60],
    ["region", "region", 60],
    ["occupation", "occupation", 60],
  ])("rejects %s longer than %d characters", (_label, field, max) => {
    expect(
      signupSchema.safeParse(validSignup({ [field]: "a".repeat(max + 1) })).success,
    ).toBe(false);
  });

  it("rejects interests with more than 20 items", () => {
    expect(
      signupSchema.safeParse(validSignup({ interests: Array(21).fill("topic") })).success,
    ).toBe(false);
  });

  it("accepts interests with exactly 20 items", () => {
    expect(
      signupSchema.safeParse(validSignup({ interests: Array(20).fill("topic") })).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loginSchema
// ---------------------------------------------------------------------------

describe("loginSchema", () => {
  it("accepts a valid email and password", () => {
    expect(
      loginSchema.safeParse({ email: "hanako@example.com", password: "short" }).success,
    ).toBe(true);
  });

  it("normalises the email to lowercase and trims whitespace", () => {
    const result = loginSchema.safeParse({
      email: "  Hanako@Example.COM  ",
      password: "short",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("hanako@example.com");
  });

  it("rejects a malformed email", () => {
    expect(loginSchema.safeParse({ email: "not-an-email", password: "short" }).success).toBe(
      false,
    );
  });

  it("allows a password shorter than MIN_PASSWORD_LENGTH (existing accounts)", () => {
    expect(
      loginSchema.safeParse({
        email: "hanako@example.com",
        password: "a".repeat(MIN_PASSWORD_LENGTH - 1),
      }).success,
    ).toBe(true);
  });

  it("allows a single-character password", () => {
    expect(
      loginSchema.safeParse({ email: "hanako@example.com", password: "x" }).success,
    ).toBe(true);
  });

  it("rejects an empty password", () => {
    expect(
      loginSchema.safeParse({ email: "hanako@example.com", password: "" }).success,
    ).toBe(false);
  });

  it("rejects a password longer than MAX_PASSWORD_LENGTH", () => {
    expect(
      loginSchema.safeParse({
        email: "hanako@example.com",
        password: "a".repeat(MAX_PASSWORD_LENGTH + 1),
      }).success,
    ).toBe(false);
  });
});
