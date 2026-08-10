import type { PostDto } from "@enjo/shared";
import { describe, expect, it } from "vitest";
import {
  parseSimulationSummary,
  rankAuthors,
  rankPosts,
} from "./simulation-analysis-service.js";

function post(
  id: string,
  overrides: Partial<Pick<PostDto, "replyTo" | "quoteOf" | "createdAt" | "author">> = {},
): PostDto {
  return {
    id,
    simulationId: "simulation-1",
    authorId: "you",
    author: overrides.author ?? { id: "you", kind: "user", handle: "you", displayName: "あなた" },
    content: `${id} content`,
    mentions: [],
    replyTo: overrides.replyTo ?? null,
    quoteOf: overrides.quoteOf ?? null,
    quotedPost: null,
    createdAt: overrides.createdAt ?? `2026-08-10T00:00:0${id.slice(-1)}.000Z`,
  };
}

describe("simulation post ranking", () => {
  it("ranks posts by received replies and reposts", () => {
    const ranking = rankPosts([
      post("post-1"),
      post("post-2", { replyTo: "post-1" }),
      post("post-3", { quoteOf: "post-1" }),
      post("post-4", { replyTo: "post-2" }),
    ]);

    expect(ranking.slice(0, 2)).toEqual([
      expect.objectContaining({ postId: "post-1", replyCount: 1, repostCount: 1, score: 2 }),
      expect.objectContaining({ postId: "post-2", replyCount: 1, repostCount: 0, score: 1 }),
    ]);
  });
});

describe("simulation author ranking", () => {
  it("ranks authors by authored posts and includes activity breakdowns", () => {
    const character = {
      id: "character-1",
      kind: "character" as const,
      handle: "alice",
      displayName: "Alice",
    };
    const ranking = rankAuthors([
      post("post-1"),
      post("post-2", { author: character, replyTo: "post-1" }),
      post("post-3", { author: character, quoteOf: "post-1" }),
      post("post-4", { replyTo: "post-2" }),
    ]);

    expect(ranking).toEqual([
      expect.objectContaining({
        author: expect.objectContaining({ id: "you" }),
        postCount: 2,
        replyCount: 1,
        repostCount: 0,
        receivedReactionCount: 2,
      }),
      expect.objectContaining({
        author: character,
        postCount: 2,
        replyCount: 1,
        repostCount: 1,
        receivedReactionCount: 1,
      }),
    ]);
  });
});

describe("simulation content summary", () => {
  it("parses all four required analysis perspectives", () => {
    expect(
      parseSimulationSummary(
        JSON.stringify({
          overallTopics: "全体の話題",
          postOverview: "投稿の種類",
          highEngagementTopics: "反響が大きい話題",
          lowEngagementTopics: "反響が少ない話題",
        }),
      ),
    ).toEqual({
      overallTopics: "全体の話題",
      postOverview: "投稿の種類",
      highEngagementTopics: "反響が大きい話題",
      lowEngagementTopics: "反響が少ない話題",
    });
  });
});
