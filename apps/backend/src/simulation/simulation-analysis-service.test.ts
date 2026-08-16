import type { PostDto } from "@brickr/shared";
import { describe, expect, it } from "vitest";
import type { LLMClient } from "../llm/llm-client.js";
import type { LLMProviderRegistry } from "../llm/provider-registry.js";
import type { PostService } from "../posts/post-service.js";
import {
  parseSimulationSummary,
  rankAuthors,
  rankPosts,
  SimulationAnalysisService,
} from "./simulation-analysis-service.js";
import {
  GlobalSimulationMutationError,
  SimulationForbiddenError,
  SimulationNotFoundError,
} from "./simulation-service.js";
import type { SimulationRepository } from "./simulation-repository.js";
import type { Simulation } from "./simulation.js";

function post(
  id: string,
  overrides: Partial<Pick<PostDto, "replyTo" | "quoteOf" | "createdAt" | "author">> = {},
): PostDto {
  return {
    id,
    roomId: "simulation-1",
    author: overrides.author ?? { id: "user-1", handle: "hanako", displayName: "花子" },
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
        author: expect.objectContaining({ id: "user-1" }),
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

describe("SimulationAnalysisService.analyze ownership (§66.6)", () => {
  const simulation: Simulation = {
    id: "sim-1",
    title: null,
    status: "active",
    scope: "room",
    visibility: "public",
    tags: [],
    createdAt: new Date("2026-08-10T00:00:00Z"),
    lastActivityAt: new Date("2026-08-10T00:00:00Z"),
    createdByUserId: "user-1",
  };

  function makeService(found: Simulation | null) {
    const simulations = {
      findById: (id: string) => Promise.resolve(id === found?.id ? found : null),
    } as unknown as SimulationRepository;
    const posts = {
      listByRoom: () => Promise.resolve([]),
    } as unknown as PostService;
    return new SimulationAnalysisService(
      simulations,
      posts,
      {} as unknown as LLMClient,
      { preferred: () => null } as unknown as LLMProviderRegistry,
    );
  }

  it("allows the creator", async () => {
    const service = makeService(simulation);
    await expect(
      service.analyze("sim-1", { id: "user-1", isAdmin: false }),
    ).resolves.toMatchObject({ postCount: 0 });
  });

  it("allows an admin who is not the creator", async () => {
    const service = makeService(simulation);
    await expect(
      service.analyze("sim-1", { id: "someone-else", isAdmin: true }),
    ).resolves.toMatchObject({ postCount: 0 });
  });

  it("rejects a signed-in caller who is neither the creator nor an admin", async () => {
    const service = makeService(simulation);
    await expect(
      service.analyze("sim-1", { id: "someone-else", isAdmin: false }),
    ).rejects.toBeInstanceOf(SimulationForbiddenError);
  });

  it("rejects a non-admin when the simulation predates login and has no owner", async () => {
    const noOwner: Simulation = { ...simulation, createdByUserId: undefined };
    const service = makeService(noOwner);
    await expect(
      service.analyze("sim-1", { id: "user-1", isAdmin: false }),
    ).rejects.toBeInstanceOf(SimulationForbiddenError);
  });

  it("still 404s for an unknown simulation before checking ownership", async () => {
    const service = makeService(null);
    await expect(
      service.analyze("missing", { id: "user-1", isAdmin: true }),
    ).rejects.toBeInstanceOf(SimulationNotFoundError);
  });
});

describe("SimulationAnalysisService.analyze global feed protection (§8.2)", () => {
  it("refuses to analyze the reserved global feed simulation, admin included", async () => {
    const globalSimulation: Simulation = {
      id: "sim-1",
      title: null,
      status: "active",
      scope: "global",
      visibility: "public",
      tags: [],
      createdAt: new Date("2026-08-10T00:00:00Z"),
      lastActivityAt: new Date("2026-08-10T00:00:00Z"),
    };
    const simulations = {
      findById: (id: string) => Promise.resolve(id === globalSimulation.id ? globalSimulation : null),
    } as unknown as SimulationRepository;
    const posts = {
      listByRoom: () => Promise.resolve([]),
    } as unknown as PostService;
    const service = new SimulationAnalysisService(
      simulations,
      posts,
      {} as unknown as LLMClient,
      { preferred: () => null } as unknown as LLMProviderRegistry,
    );

    await expect(
      service.analyze("sim-1", { id: "someone", isAdmin: true }),
    ).rejects.toBeInstanceOf(GlobalSimulationMutationError);
  });
});
