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

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: "post-1",
    simulationId: "sim-1",
    authorId: "user-1",
    content: "hello",
    mentions: [],
    replyTo: null,
    quoteOf: null,
    threadRootId: "post-1",
    threadActivityAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("toPostDto author resolution", () => {
  it("resolves a user author from the user map", () => {
    const dto = toPostDto(post(), new Map(), null, indexUsersById([hanako]));

    expect(dto.author).toEqual({
      id: "user-1",
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

    expect(dto.author).toMatchObject({ id: "character-1", handle: "architect" });
  });

  it("falls back to a placeholder for an author it cannot resolve", () => {
    const dto = toPostDto(post({ authorId: "gone" }), new Map(), null, new Map());

    expect(dto.author).toMatchObject({ id: "gone", handle: "gone" });
  });

  /**
   * The point of the whole mapper: a person and a character come back
   * indistinguishable, so nothing downstream can label one of them (§9.1, §25).
   */
  it("gives a user and a character byte-identical author keys", () => {
    const character = {
      id: "character-1",
      handle: "architect",
      displayName: "アーキテクト",
      avatarUrl: "https://example.com/architect.png",
    } as unknown as Character;

    const userDto = toPostDto(post(), new Map(), null, indexUsersById([hanako]));
    const characterDto = toPostDto(
      post({ authorId: "character-1" }),
      new Map([["character-1", character]]),
      null,
      new Map(),
    );

    expect(Object.keys(characterDto.author).sort()).toEqual(
      Object.keys(userDto.author).sort(),
    );
    expect(Object.keys(userDto.author).sort()).toEqual([
      "avatarUrl",
      "displayName",
      "handle",
      "id",
    ]);
  });

  it("keeps the author id off the post itself, so ownership reads from author.id (§9.1)", () => {
    const dto = toPostDto(post(), new Map(), null, indexUsersById([hanako]));

    expect(dto).not.toHaveProperty("authorId");
    expect(dto.author.id).toBe("user-1");
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
