import type {
  PostDto,
  RoomAnalysisDto,
  RoomAuthorRankingDto,
  RoomPostRankingDto,
  RoomContentSummaryDto,
} from "@brickr/shared";
import { z } from "zod";
import type { LLMClient } from "../llm/llm-client.js";
import type { LLMProviderRegistry } from "../llm/provider-registry.js";
import type { PostService } from "../posts/post-service.js";
import type { SimulationRepository } from "./simulation-repository.js";
import {
  assertSimulationOwnerOrAdmin,
  SimulationNotFoundError,
  toSimulationDto,
  type SimulationActor,
} from "./simulation-service.js";

const SUMMARY_POST_LIMIT = 100;
const SUMMARY_CONTENT_LIMIT = 500;
const RANKING_LIMIT = 10;
const AUTHOR_RANKING_LIMIT = 10;

const summarySchema = z.object({
  overallTopics: z.string().trim().min(1),
  postOverview: z.string().trim().min(1),
  highEngagementTopics: z.string().trim().min(1),
  lowEngagementTopics: z.string().trim().min(1),
});

export class SimulationAnalysisService {
  constructor(
    private readonly simulations: SimulationRepository,
    private readonly posts: PostService,
    private readonly llm: LLMClient,
    private readonly providers: LLMProviderRegistry,
  ) {}

  async analyze(id: string, actor: SimulationActor): Promise<RoomAnalysisDto> {
    const simulation = await this.simulations.findById(id);
    if (!simulation) throw new SimulationNotFoundError(id);
    assertSimulationOwnerOrAdmin(simulation, actor);

    const posts = await this.posts.listByRoom(id);
    const replyCount = posts.filter((post) => post.replyTo !== null).length;
    const repostCount = posts.filter((post) => post.quoteOf !== null).length;

    return {
      simulation: toSimulationDto(simulation),
      summary: await this.summarize(posts),
      postCount: posts.length,
      authorCount: new Set(posts.map((post) => post.author.id)).size,
      replyCount,
      repostCount,
      ranking: rankPosts(posts),
      authorRanking: rankAuthors(posts),
    };
  }

  private async summarize(posts: PostDto[]): Promise<RoomContentSummaryDto> {
    if (posts.length === 0) return emptySummary();

    const provider = this.providers.preferred();
    if (!provider) return fallbackSummary(posts);

    const received = receivedReactionCounts(posts);
    const transcript = posts
      .slice(-SUMMARY_POST_LIMIT)
      .map((post) =>
        [
          `@${post.author.handle}`,
          `返信獲得:${String(received.get(post.id)?.replies ?? 0)}`,
          `リポスト獲得:${String(received.get(post.id)?.reposts ?? 0)}`,
          post.content.slice(0, SUMMARY_CONTENT_LIMIT) || "[画像のみ]",
        ].join(" | "),
      )
      .join("\n");

    try {
      const result = await this.llm.generate(provider.id, {
        model: provider.defaultModel,
        systemPrompt:
          "あなたはSNS上の会話を中立的に分析する編集者です。投稿内容と各投稿が獲得した返信・リポスト数だけを根拠に、シミュレーション全体を4つの観点で日本語分析してください。反響の大小は提示された数値を比較し、事実を足さないでください。JSON以外は返さないでください。",
        messages: [{ role: "user", content: transcript }],
        maxOutputTokens: 500,
        temperature: 0.2,
        structuredOutput: {
          name: "simulation_summary",
          schema: simulationSummaryJsonSchema,
        },
      });
      return parseSimulationSummary(result.text);
    } catch {
      return fallbackSummary(posts);
    }
  }
}

const simulationSummaryJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    overallTopics: { type: "string" },
    postOverview: { type: "string" },
    highEngagementTopics: { type: "string" },
    lowEngagementTopics: { type: "string" },
  },
  required: ["overallTopics", "postOverview", "highEngagementTopics", "lowEngagementTopics"],
};

export function parseSimulationSummary(text: string): RoomContentSummaryDto {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("summary JSON was not found");
  return summarySchema.parse(JSON.parse(text.slice(start, end + 1)));
}

export function rankPosts(posts: PostDto[]): RoomPostRankingDto[] {
  const reactions = receivedReactionCounts(posts);

  return posts
    .map((post) => {
      const reaction = reactions.get(post.id) ?? { replies: 0, reposts: 0 };
      return {
        postId: post.id,
        content: post.content,
        author: post.author,
        replyCount: reaction.replies,
        repostCount: reaction.reposts,
        score: reaction.replies + reaction.reposts,
        createdAt: post.createdAt,
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.replyCount - left.replyCount ||
        right.createdAt.localeCompare(left.createdAt),
    )
    .slice(0, RANKING_LIMIT);
}

export function rankAuthors(posts: PostDto[]): RoomAuthorRankingDto[] {
  const received = receivedReactionCounts(posts);

  const authors = new Map<string, RoomAuthorRankingDto>();
  for (const post of posts) {
    const current = authors.get(post.author.id) ?? {
      author: post.author,
      postCount: 0,
      replyCount: 0,
      repostCount: 0,
      receivedReactionCount: 0,
    };
    current.postCount += 1;
    if (post.replyTo) current.replyCount += 1;
    if (post.quoteOf) current.repostCount += 1;
    const reaction = received.get(post.id);
    current.receivedReactionCount += (reaction?.replies ?? 0) + (reaction?.reposts ?? 0);
    authors.set(post.author.id, current);
  }

  return [...authors.values()]
    .sort(
      (left, right) =>
        right.postCount - left.postCount ||
        right.receivedReactionCount - left.receivedReactionCount ||
        left.author.displayName.localeCompare(right.author.displayName, "ja"),
    )
    .slice(0, AUTHOR_RANKING_LIMIT);
}

function fallbackSummary(posts: PostDto[]): RoomContentSummaryDto {
  const topics = posts
    .filter((post) => post.content.trim().length > 0)
    .slice(0, 3)
    .map((post) => `「${post.content.trim().slice(0, 80)}」`);
  const received = receivedReactionCounts(posts);
  const ranked = [...posts].sort((left, right) => {
    const leftCount = received.get(left.id);
    const rightCount = received.get(right.id);
    return (
      (rightCount?.replies ?? 0) + (rightCount?.reposts ?? 0) -
      ((leftCount?.replies ?? 0) + (leftCount?.reposts ?? 0))
    );
  });
  const high = ranked[0];
  const low = ranked.at(-1);
  const highReaction = high ? received.get(high.id) : undefined;
  const hasReaction =
    (highReaction?.replies ?? 0) + (highReaction?.reposts ?? 0) > 0;
  return {
    overallTopics:
      topics.length > 0
        ? `主に${topics.join("、")}が話題になりました。`
        : "画像を中心とした投稿が話題になりました。",
    postOverview: `合計${String(posts.length)}件の投稿があり、返信や引用を通じて会話が展開されました。`,
    highEngagementTopics: high && hasReaction
      ? `最も反響が大きかった投稿は「${high.content.slice(0, 100) || "画像のみの投稿"}」です。`
      : "返信やリポストを得た投稿はありません。",
    lowEngagementTopics: low && hasReaction
      ? `反響が比較的少なかった投稿は「${low.content.slice(0, 100) || "画像のみの投稿"}」です。`
      : "すべての投稿の反響は同程度です。",
  };
}

function emptySummary(): RoomContentSummaryDto {
  return {
    overallTopics: "まだ話題はありません。",
    postOverview: "このシミュレーションにはまだ投稿がありません。",
    highEngagementTopics: "反響を比較できる投稿がありません。",
    lowEngagementTopics: "反響を比較できる投稿がありません。",
  };
}

function receivedReactionCounts(
  posts: PostDto[],
): Map<string, { replies: number; reposts: number }> {
  const received = new Map<string, { replies: number; reposts: number }>();
  for (const post of posts) {
    if (post.replyTo) {
      const count = received.get(post.replyTo) ?? { replies: 0, reposts: 0 };
      count.replies += 1;
      received.set(post.replyTo, count);
    }
    if (post.quoteOf) {
      const count = received.get(post.quoteOf) ?? { replies: 0, reposts: 0 };
      count.reposts += 1;
      received.set(post.quoteOf, count);
    }
  }
  return received;
}
