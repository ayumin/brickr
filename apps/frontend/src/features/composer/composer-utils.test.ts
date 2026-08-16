import { describe, expect, it } from "vitest";
import type { PostDto } from "@brickr/shared";
import {
  appendMentionOnce,
  composerContextForQuote,
  composerContextForReply,
  composerDialogTitle,
  initialComposerContent,
} from "./composer-utils";

function makePost(overrides: Partial<PostDto> = {}): PostDto {
  return {
    id: "post-1",
    roomId: "sim-1",
    author: { id: "author-1", handle: "architect", displayName: "Architect", avatarUrl: undefined },
    content: "hello",
    mentions: [],
    replyTo: null,
    quoteOf: null,
    quotedPost: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("appendMentionOnce", () => {
  it("adds a mention to empty content", () => {
    expect(appendMentionOnce("", "skeptic")).toBe("@skeptic ");
  });

  it("does not add the same mention twice", () => {
    const once = appendMentionOnce("", "skeptic");
    expect(appendMentionOnce(once, "skeptic")).toBe("@skeptic ");
  });

  it("matches existing handles case-insensitively", () => {
    expect(appendMentionOnce("@SKEPTIC 質問です", "skeptic")).toBe(
      "@SKEPTIC 質問です",
    );
  });

  it("still permits mentioning a different character", () => {
    expect(appendMentionOnce("@skeptic 質問です", "architect")).toBe(
      "@skeptic 質問です @architect ",
    );
  });
});

describe("composerContextForReply / composerContextForQuote", () => {
  it("targets the post's own room, not wherever the reader is", () => {
    const post = makePost({ roomId: "room-42" });
    expect(composerContextForReply(post)).toEqual({ mode: "reply", simulationId: "room-42", post });
    expect(composerContextForQuote(post)).toEqual({ mode: "quote", simulationId: "room-42", post });
  });
});

describe("composerDialogTitle", () => {
  it("labels each mode", () => {
    expect(composerDialogTitle({ mode: "new", simulationId: "s", roomLabel: "フィード" })).toBe("投稿する");
    expect(composerDialogTitle({ mode: "reply", simulationId: "s", post: makePost() })).toBe("返信する");
    expect(composerDialogTitle({ mode: "quote", simulationId: "s", post: makePost() })).toBe("引用してリポスト");
  });
});

describe("initialComposerContent", () => {
  it("is empty for a new post", () => {
    expect(initialComposerContent({ mode: "new", simulationId: "s", roomLabel: "フィード" }, "me")).toBe("");
  });

  it("is empty for a quote (no mention prefill)", () => {
    expect(initialComposerContent(composerContextForQuote(makePost()), "me")).toBe("");
  });

  it("prefills @handle when replying to someone else", () => {
    const post = makePost({ author: { id: "other", handle: "skeptic", displayName: "Skeptic", avatarUrl: undefined } });
    expect(initialComposerContent(composerContextForReply(post), "me")).toBe("@skeptic ");
  });

  it("does not mention yourself when replying to your own post", () => {
    const post = makePost({ author: { id: "me", handle: "you", displayName: "You", avatarUrl: undefined } });
    expect(initialComposerContent(composerContextForReply(post), "me")).toBe("");
  });
});
