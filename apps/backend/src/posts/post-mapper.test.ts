import { USER_AUTHOR_ID } from "@enjo/shared";
import { describe, expect, it } from "vitest";
import type { Post } from "./post.js";
import { toPostDto } from "./post-mapper.js";

describe("toPostDto user profile", () => {
  it("uses the editable user profile for user-authored posts", () => {
    const post: Post = {
      id: "post-1",
      simulationId: "sim-1",
      authorId: USER_AUTHOR_ID,
      content: "hello",
      mentions: [],
      replyTo: null,
      quoteOf: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    };

    const dto = toPostDto(post, new Map(), null, {
      id: USER_AUTHOR_ID,
      displayName: "編集後のユーザー",
      description: "プロフィール",
      avatarUrl: "https://example.com/avatar.png",
    });

    expect(dto.author).toMatchObject({
      id: USER_AUTHOR_ID,
      kind: "user",
      handle: "you",
      displayName: "編集後のユーザー",
      avatarUrl: "https://example.com/avatar.png",
    });
  });
});
