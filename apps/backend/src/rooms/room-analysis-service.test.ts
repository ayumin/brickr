import type { PostDto } from "@brickr/shared";
import { describe, expect, it } from "vitest";
import type { LLMClient } from "../llm/llm-client.js";
import type { LLMProviderRegistry } from "../llm/provider-registry.js";
import type { PostService } from "../posts/post-service.js";
import {
  parseRoomSummary,
  rankAuthors,
  rankPosts,
  RoomAnalysisService,
} from "./room-analysis-service.js";
import { RoomManageForbiddenError } from "./room-runtime-service.js";
import { RoomNotFoundError } from "./room-errors.js";
import type { RoomRepository } from "./room-repository.js";
import type { Room } from "./room.js";

function post(
  id: string,
  overrides: Partial<Pick<PostDto, "replyTo" | "quoteOf" | "createdAt" | "author">> = {},
): PostDto {
  return {
    id,
    roomId: "room-1",
    author: overrides.author ?? { id: "user-1", handle: "hanako", displayName: "花子" },
    content: `${id} content`,
    mentions: [],
    replyTo: overrides.replyTo ?? null,
    quoteOf: overrides.quoteOf ?? null,
    quotedPost: null,
    createdAt: overrides.createdAt ?? `2026-08-10T00:00:0${id.slice(-1)}.000Z`,
  };
}

describe("room post ranking", () => {
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

describe("room author ranking", () => {
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

describe("room content summary", () => {
  it("parses all four required analysis perspectives", () => {
    expect(
      parseRoomSummary(
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

describe("RoomAnalysisService.analyze ownership (§66.6)", () => {
  const room: Room = {
    id: "sim-1",
    title: null,
    status: "active",
    visibility: "public",
    scope: "room",
    tags: [],
    createdAt: new Date("2026-08-10T00:00:00Z"),
    lastActivityAt: new Date("2026-08-10T00:00:00Z"),
    createdByUserId: "user-1",
  };

  function makeService(found: Room | null) {
    const rooms = {
      findById: (id: string) => Promise.resolve(id === found?.id ? found : null),
    } as unknown as RoomRepository;
    const posts = {
      listByRoom: () => Promise.resolve([]),
    } as unknown as PostService;
    return new RoomAnalysisService(
      rooms,
      posts,
      {} as unknown as LLMClient,
      { preferred: () => null } as unknown as LLMProviderRegistry,
    );
  }

  it("allows the creator", async () => {
    const service = makeService(room);
    await expect(
      service.analyze("sim-1", { id: "user-1", isAdmin: false }),
    ).resolves.toMatchObject({ postCount: 0 });
  });

  it("allows an admin who is not the creator", async () => {
    const service = makeService(room);
    await expect(
      service.analyze("sim-1", { id: "someone-else", isAdmin: true }),
    ).resolves.toMatchObject({ postCount: 0 });
  });

  it("rejects a signed-in caller who is neither the creator nor an admin", async () => {
    const service = makeService(room);
    await expect(
      service.analyze("sim-1", { id: "someone-else", isAdmin: false }),
    ).rejects.toBeInstanceOf(RoomManageForbiddenError);
  });

  it("rejects a non-admin when the room predates login and has no owner", async () => {
    const noOwner: Room = { ...room, createdByUserId: undefined };
    const service = makeService(noOwner);
    await expect(
      service.analyze("sim-1", { id: "user-1", isAdmin: false }),
    ).rejects.toBeInstanceOf(RoomManageForbiddenError);
  });

  it("still 404s for an unknown room before checking ownership", async () => {
    const service = makeService(null);
    await expect(
      service.analyze("missing", { id: "user-1", isAdmin: true }),
    ).rejects.toBeInstanceOf(RoomNotFoundError);
  });
});


