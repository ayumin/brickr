/**
 * Tests for RoomAnalysisSnapshotService (issue #166).
 *
 * Covers:
 *   - get(): permission checks (owner, admin, active member, non-member)
 *   - get(): 404 when no snapshot exists
 *   - update(): permission checks (owner, admin, non-owner)
 *   - update(): archived room rejection
 *   - update(): change detection (no-op when postCount + latestPostId unchanged)
 *   - update(): LLM failure → status "failed"
 *   - update(): successful generation → status "completed"
 */
import { describe, expect, it, vi } from "vitest";
import type { PostDto } from "@brickr/shared";
import type { LLMClient } from "../llm/llm-client.js";
import type { LLMProviderRegistry } from "../llm/provider-registry.js";
import type { PostService } from "../posts/post-service.js";
import type { RoomAnalysisSnapshotRepository } from "./room-analysis-snapshot-repository.js";
import type { RoomMembershipRepository } from "./room-membership-repository.js";
import type { SimulationRepository } from "./simulation-repository.js";
import type { Simulation } from "./simulation.js";
import {
  RoomAnalysisSnapshotService,
  SnapshotForbiddenError,
  SnapshotNotFoundError,
  SnapshotRoomArchivedError,
  SnapshotRoomNotFoundError,
} from "./room-analysis-snapshot-service.js";
import type { RoomAnalysisSnapshot } from "./room-analysis-snapshot-repository.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const activeRoom: Simulation = {
  id: "room-1",
  title: "テストルーム",
  status: "active",
  visibility: "public",
  tags: [],
  createdAt: new Date("2026-08-16T00:00:00Z"),
  lastActivityAt: new Date("2026-08-16T00:00:00Z"),
  createdByUserId: "owner-1",
};

const archivedRoom: Simulation = {
  ...activeRoom,
  status: "archived",
};

const closedRoom: Simulation = {
  ...activeRoom,
  visibility: "closed",
};

const completedSnapshot: RoomAnalysisSnapshot = {
  id: "snap-1",
  roomId: "room-1",
  postCount: 3,
  latestPostId: "post-3",
  summary: JSON.stringify({ overallTopics: "話題", postOverview: "概要", highEngagementTopics: "高", lowEngagementTopics: "低" }),
  status: "completed",
  error: null,
  createdAt: new Date("2026-08-16T00:00:00Z"),
  updatedAt: new Date("2026-08-16T00:00:00Z"),
};

function makePost(id: string): PostDto {
  return {
    id,
    roomId: "room-1",
    author: { id: "user-1", handle: "hanako", displayName: "花子" },
    content: `${id} content`,
    mentions: [],
    replyTo: null,
    quoteOf: null,
    quotedPost: null,
    createdAt: `2026-08-16T00:00:0${id.slice(-1)}.000Z`,
  };
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeSimulations(room: Simulation | null): SimulationRepository {
  return {
    findById: (id: string) => Promise.resolve(id === room?.id ? room : null),
  } as unknown as SimulationRepository;
}

function makeSnapshots(snapshot: RoomAnalysisSnapshot | null): RoomAnalysisSnapshotRepository {
  return {
    findByRoom: () => Promise.resolve(snapshot),
    upsert: vi.fn((input) => {
      const preserveSuccessful =
        input.status === "failed" && snapshot !== null && snapshot.summary !== null;
      return Promise.resolve({
        id: "snap-new",
        roomId: input.roomId,
        postCount: preserveSuccessful ? snapshot.postCount : input.postCount,
        latestPostId: preserveSuccessful ? snapshot.latestPostId : input.latestPostId,
        summary: preserveSuccessful ? snapshot.summary : input.summary,
        status: input.status,
        error: input.error,
        createdAt: new Date("2026-08-16T00:00:00Z"),
        updatedAt: new Date("2026-08-16T00:00:00Z"),
      } satisfies RoomAnalysisSnapshot);
    }),
  } as unknown as RoomAnalysisSnapshotRepository;
}

function makePosts(posts: PostDto[]): PostService {
  return {
    listByRoom: () => Promise.resolve(posts),
  } as unknown as PostService;
}

function makeMemberships(status?: string): RoomMembershipRepository {
  return {
    findOne: () =>
      Promise.resolve(
        status
          ? { id: "m-1", roomId: "room-1", memberKind: "user", memberId: "member-1", role: "member", status, createdAt: new Date(), updatedAt: new Date() }
          : null,
      ),
  } as unknown as RoomMembershipRepository;
}

function makeLLM(result: string | Error): LLMClient {
  return {
    generate: () =>
      result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve({ text: result, providerId: "openai", model: "gpt-4o" }),
  } as unknown as LLMClient;
}

function makeProviders(hasProvider: boolean): LLMProviderRegistry {
  return {
    preferred: () =>
      hasProvider ? { id: "openai", defaultModel: "gpt-4o" } : null,
  } as unknown as LLMProviderRegistry;
}

function makeService(overrides: {
  room?: Simulation | null;
  snapshot?: RoomAnalysisSnapshot | null;
  posts?: PostDto[];
  membershipStatus?: string;
  llmResult?: string | Error;
  hasProvider?: boolean;
}): RoomAnalysisSnapshotService {
  const {
    room = activeRoom,
    snapshot = completedSnapshot,
    posts = [makePost("post-1"), makePost("post-2"), makePost("post-3")],
    membershipStatus,
    llmResult = JSON.stringify({
      overallTopics: "話題",
      postOverview: "概要",
      highEngagementTopics: "高",
      lowEngagementTopics: "低",
    }),
    hasProvider = true,
  } = overrides;

  return new RoomAnalysisSnapshotService({
    snapshots: makeSnapshots(snapshot),
    simulations: makeSimulations(room),
    memberships: makeMemberships(membershipStatus),
    posts: makePosts(posts),
    llm: makeLLM(llmResult),
    providers: makeProviders(hasProvider),
  });
}

// ---------------------------------------------------------------------------
// get() — permission checks
// ---------------------------------------------------------------------------

describe("RoomAnalysisSnapshotService.get() permissions", () => {
  it("allows the room owner", async () => {
    const service = makeService({});
    await expect(
      service.get("room-1", { id: "owner-1", isAdmin: false }),
    ).resolves.toMatchObject({ snapshot: { id: "snap-1" } });
  });

  it("allows an admin who is not the owner", async () => {
    const service = makeService({});
    await expect(
      service.get("room-1", { id: "someone-else", isAdmin: true }),
    ).resolves.toMatchObject({ snapshot: { id: "snap-1" } });
  });

  it("allows any authenticated user for public rooms", async () => {
    const service = makeService({ room: { ...activeRoom, visibility: "public" } });
    await expect(
      service.get("room-1", { id: "random-user", isAdmin: false }),
    ).resolves.toMatchObject({ snapshot: { id: "snap-1" } });
  });

  it("allows any authenticated user for open rooms", async () => {
    const service = makeService({ room: { ...activeRoom, visibility: "open" } });
    await expect(
      service.get("room-1", { id: "random-user", isAdmin: false }),
    ).resolves.toMatchObject({ snapshot: { id: "snap-1" } });
  });

  it("allows an active member of a closed room", async () => {
    const service = makeService({
      room: closedRoom,
      membershipStatus: "active",
    });
    await expect(
      service.get("room-1", { id: "member-1", isAdmin: false }),
    ).resolves.toMatchObject({ snapshot: { id: "snap-1" } });
  });

  it("refuses a non-member of a closed room", async () => {
    const service = makeService({
      room: closedRoom,
      membershipStatus: undefined,
    });
    await expect(
      service.get("room-1", { id: "outsider", isAdmin: false }),
    ).rejects.toBeInstanceOf(SnapshotForbiddenError);
  });

  it("refuses a pending member of a closed room", async () => {
    const service = makeService({
      room: closedRoom,
      membershipStatus: "pending",
    });
    await expect(
      service.get("room-1", { id: "member-1", isAdmin: false }),
    ).rejects.toBeInstanceOf(SnapshotForbiddenError);
  });

  it("refuses a non-member of a private room", async () => {
    const service = makeService({
      room: { ...activeRoom, visibility: "private" },
      membershipStatus: undefined,
    });
    await expect(
      service.get("room-1", { id: "outsider", isAdmin: false }),
    ).rejects.toBeInstanceOf(SnapshotForbiddenError);
  });

  it("throws SnapshotRoomNotFoundError for an unknown room", async () => {
    const service = makeService({ room: null });
    await expect(
      service.get("missing", { id: "owner-1", isAdmin: false }),
    ).rejects.toBeInstanceOf(SnapshotRoomNotFoundError);
  });

  it("throws SnapshotNotFoundError when no snapshot exists", async () => {
    const service = makeService({ snapshot: null });
    await expect(
      service.get("room-1", { id: "owner-1", isAdmin: false }),
    ).rejects.toBeInstanceOf(SnapshotNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// update() — permission checks
// ---------------------------------------------------------------------------

describe("RoomAnalysisSnapshotService.update() permissions", () => {
  it("allows the room owner", async () => {
    // Force a new snapshot by changing postCount
    const service = makeService({
      snapshot: { ...completedSnapshot, postCount: 0 },
    });
    await expect(
      service.update("room-1", { id: "owner-1", isAdmin: false }),
    ).resolves.toMatchObject({ updated: true });
  });

  it("allows an admin who is not the owner", async () => {
    const service = makeService({
      snapshot: { ...completedSnapshot, postCount: 0 },
    });
    await expect(
      service.update("room-1", { id: "someone-else", isAdmin: true }),
    ).resolves.toMatchObject({ updated: true });
  });

  it("refuses a non-owner, non-admin user", async () => {
    const service = makeService({});
    await expect(
      service.update("room-1", { id: "random-user", isAdmin: false }),
    ).rejects.toBeInstanceOf(SnapshotForbiddenError);
  });

  it("refuses update on an archived room", async () => {
    const service = makeService({ room: archivedRoom });
    await expect(
      service.update("room-1", { id: "owner-1", isAdmin: false }),
    ).rejects.toBeInstanceOf(SnapshotRoomArchivedError);
  });

  it("throws SnapshotRoomNotFoundError for an unknown room", async () => {
    const service = makeService({ room: null });
    await expect(
      service.update("missing", { id: "owner-1", isAdmin: false }),
    ).rejects.toBeInstanceOf(SnapshotRoomNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// update() — change detection
// ---------------------------------------------------------------------------

describe("RoomAnalysisSnapshotService.update() change detection", () => {
  it("skips generation when postCount and latestPostId are unchanged", async () => {
    // The existing snapshot already matches the current room state.
    const service = makeService({
      snapshot: completedSnapshot, // postCount=3, latestPostId="post-3"
      posts: [makePost("post-1"), makePost("post-2"), makePost("post-3")],
    });
    const result = await service.update("room-1", { id: "owner-1", isAdmin: false });
    expect(result.updated).toBe(false);
    expect(result.snapshot.id).toBe("snap-1");
  });

  it("generates a new snapshot when postCount changes", async () => {
    const service = makeService({
      snapshot: { ...completedSnapshot, postCount: 2 },
      posts: [makePost("post-1"), makePost("post-2"), makePost("post-3")],
    });
    const result = await service.update("room-1", { id: "owner-1", isAdmin: false });
    expect(result.updated).toBe(true);
  });

  it("generates a new snapshot when latestPostId changes", async () => {
    const service = makeService({
      snapshot: { ...completedSnapshot, latestPostId: "post-2" },
      posts: [makePost("post-1"), makePost("post-2"), makePost("post-3")],
    });
    const result = await service.update("room-1", { id: "owner-1", isAdmin: false });
    expect(result.updated).toBe(true);
  });

  it("generates a new snapshot when no prior snapshot exists", async () => {
    const service = makeService({
      snapshot: null,
      posts: [makePost("post-1")],
    });
    const result = await service.update("room-1", { id: "owner-1", isAdmin: false });
    expect(result.updated).toBe(true);
  });

  it("generates a new snapshot when the prior snapshot has status 'failed'", async () => {
    const service = makeService({
      snapshot: { ...completedSnapshot, status: "failed", error: "LLM error" },
      posts: [makePost("post-1"), makePost("post-2"), makePost("post-3")],
    });
    const result = await service.update("room-1", { id: "owner-1", isAdmin: false });
    expect(result.updated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// update() — LLM outcomes
// ---------------------------------------------------------------------------

describe("RoomAnalysisSnapshotService.update() LLM outcomes", () => {
  it("saves status 'completed' on successful LLM generation", async () => {
    const service = makeService({
      snapshot: null,
      posts: [makePost("post-1")],
    });
    const result = await service.update("room-1", { id: "owner-1", isAdmin: false });
    expect(result.snapshot.status).toBe("completed");
    expect(result.snapshot.error).toBeNull();
  });

  it("saves status 'failed' when the LLM call throws", async () => {
    const service = makeService({
      snapshot: null,
      posts: [makePost("post-1")],
      llmResult: new Error("LLM timeout"),
    });
    const result = await service.update("room-1", { id: "owner-1", isAdmin: false });
    expect(result.snapshot.status).toBe("failed");
    expect(result.snapshot.error).toBe("LLM timeout");
    expect(result.updated).toBe(true);
  });

  it("preserves and returns the last successful analysis when regeneration fails", async () => {
    const service = makeService({
      snapshot: completedSnapshot,
      posts: [makePost("post-1"), makePost("post-2"), makePost("post-4")],
      llmResult: new Error("LLM timeout"),
    });

    const result = await service.update("room-1", { id: "owner-1", isAdmin: false });

    expect(result.snapshot).toMatchObject({
      status: "failed",
      error: "LLM timeout",
      summary: completedSnapshot.summary,
      postCount: completedSnapshot.postCount,
      latestPostId: completedSnapshot.latestPostId,
      lastSuccessful: {
        status: "completed",
        error: null,
        summary: completedSnapshot.summary,
        postCount: completedSnapshot.postCount,
        latestPostId: completedSnapshot.latestPostId,
      },
    });
  });

  it("fetches room posts only once while generating a summary", async () => {
    const listByRoom = vi.fn(() => Promise.resolve([makePost("post-1")]));
    const service = new RoomAnalysisSnapshotService({
      snapshots: makeSnapshots(null),
      simulations: makeSimulations(activeRoom),
      memberships: makeMemberships(),
      posts: { listByRoom } as unknown as PostService,
      llm: makeLLM(JSON.stringify({
        overallTopics: "話題",
        postOverview: "概要",
        highEngagementTopics: "高",
        lowEngagementTopics: "低",
      })),
      providers: makeProviders(true),
    });

    await service.update("room-1", { id: "owner-1", isAdmin: false });

    expect(listByRoom).toHaveBeenCalledTimes(1);
  });

  it("produces a non-null summary when no LLM provider is available", async () => {
    const service = makeService({
      snapshot: null,
      posts: [makePost("post-1")],
      hasProvider: false,
    });
    const result = await service.update("room-1", { id: "owner-1", isAdmin: false });
    expect(result.snapshot.status).toBe("completed");
    expect(result.snapshot.summary).not.toBeNull();
  });

  it("produces a non-null summary for an empty room", async () => {
    const service = makeService({
      snapshot: null,
      posts: [],
    });
    const result = await service.update("room-1", { id: "owner-1", isAdmin: false });
    expect(result.snapshot.status).toBe("completed");
    expect(result.snapshot.summary).not.toBeNull();
    expect(result.snapshot.postCount).toBe(0);
    expect(result.snapshot.latestPostId).toBeNull();
  });
});
