import { describe, expect, it } from "vitest";
import type { UserProfile } from "../user-profile/user-profile.js";
import type { Character } from "../characters/character.js";
import type { Post } from "./post.js";
import { indexUsersById, toPostDto } from "./post-mapper.js";

const hanako: UserProfile = {
  id: "user-1",
  handle: "hanako",
  displayName: "花子",
  description: "プロフィール",
  avatarUrl: "https://example.com/hanako.png",
};

const taro: UserProfile = {
  id: "user-2",
  handle: "taro",
  displayName: "太郎",
  description: "",
};

/** The pre-login singleton, which the seed backfilled with handle `you`. */
const legacyUser: UserProfile = {
  id: "you",
  handle: "you",
  displayName: "編集後のユーザー",
  description: "プロフィール",
  avatarUrl: "https://example.com/avatar.png",
};

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: "post-1",
    simulationId: "sim-1",
    authorId: "user-1",
    content: "hello",
    mentions: [],
    replyTo: null,
    quoteOf: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("toPostDto author resolution", () => {
  it("resolves a user author from the user map", () => {
    const dto = toPostDto(post(), new Map(), null, indexUsersById([hanako]));

    expect(dto.author).toEqual({
      id: "user-1",
      kind: "user",
      handle: "hanako",
      displayName: "花子",
      avatarUrl: "https://example.com/hanako.png",
    });
  });

  it("gives two users their own identity in the same timeline (§66.3)", () => {
    const usersById = indexUsersById([hanako, taro]);

    const first = toPostDto(post({ authorId: "user-1" }), new Map(), null, usersById);
    const second = toPostDto(post({ authorId: "user-2" }), new Map(), null, usersById);

    expect(first.author.handle).toBe("hanako");
    expect(second.author.handle).toBe("taro");
    expect(first.author.displayName).not.toBe(second.author.displayName);
  });

  it("still resolves posts written before login existed", () => {
    const dto = toPostDto(
      post({ authorId: "you" }),
      new Map(),
      null,
      indexUsersById([legacyUser]),
    );

    expect(dto.author).toMatchObject({
      id: "you",
      kind: "user",
      handle: "you",
      displayName: "編集後のユーザー",
    });
  });

  it("prefers a character when the id is a character id", () => {
    const character = {
      id: "character-1",
      handle: "architect",
      displayName: "アーキテクト",
    } as unknown as Character;

    const dto = toPostDto(
      post({ authorId: "character-1" }),
      new Map([["character-1", character]]),
      null,
      indexUsersById([hanako]),
    );

    expect(dto.author).toMatchObject({ kind: "character", handle: "architect" });
  });

  it("falls back to a placeholder for an author it cannot resolve", () => {
    const dto = toPostDto(post({ authorId: "gone" }), new Map(), null, new Map());

    expect(dto.author).toMatchObject({ id: "gone", kind: "character", handle: "gone" });
  });

  it("includes a post image in the API DTO", () => {
    const dto = toPostDto(
      post({ imageUrl: "data:image/png;base64,iVBORw0KGgo=" }),
      new Map(),
      null,
      indexUsersById([hanako]),
    );

    expect(dto.imageUrl).toBe("data:image/png;base64,iVBORw0KGgo=");
  });
});
