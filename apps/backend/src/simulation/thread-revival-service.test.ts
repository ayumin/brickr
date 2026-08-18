/**
 * Unit tests for the thread revival service (issue #165).
 *
 * All external dependencies are mocked so the tests run without a database or
 * LLM provider.
 */
import { describe, expect, it, vi } from "vitest";
import type { Character } from "../characters/character.js";
import type { Post } from "../posts/post.js";
import type { Simulation } from "../simulation/simulation.js";
import { reviveThread, DORMANT_THRESHOLD_MS, type ThreadRevivalDeps } from "./thread-revival-service.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = new Date("2026-08-17T12:00:00.000Z");
const dormantAt = new Date(now.getTime() - DORMANT_THRESHOLD_MS - 1_000); // just past threshold

const room: Simulation = {
  id: "room-1",
  title: "Test Room",
  status: "active",
  visibility: "public",
  scope: "room",
  tags: [],
  createdAt: now,
  lastActivityAt: now,
  createdByUserId: "user-1",
};

const eagerCharacter: Character = {
  id: "char-eager",
  handle: "eager",
  displayName: "Eager",
  description: "desc",
  rolePrompt: "role",
  tonePrompt: "tone",
  interests: [],
  activityLevel: 1,
  responseProbability: 1,
  replyProbability: 0.8,
  quoteProbability: 0.1,
  influence: 0,
  modelProfileId: "test-profile",
  behaviorProfileKey: "eager", // revivalWeight = 0.4
};

const dormantPost: Post = {
  id: "post-dormant",
  roomId: "room-1",
  authorId: "user-1",
  content: "This thread has gone quiet",
  mentions: [],
  replyTo: null,
  quoteOf: null,
  threadRootId: "post-dormant",
  threadActivityAt: dormantAt,
  createdAt: dormantAt,
};

const revivedPost: Post = {
  id: "post-revived",
  roomId: "room-1",
  authorId: "char-eager",
  content: "Let me revive this!",
  mentions: [],
  replyTo: "post-dormant",
  quoteOf: null,
  threadRootId: "post-dormant",
  threadActivityAt: now,
  createdAt: now,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<ThreadRevivalDeps> = {}): ThreadRevivalDeps {
  return {
    simulations: {
      findById: vi.fn(() => Promise.resolve(room)),
    } as unknown as ThreadRevivalDeps["simulations"],
    characters: {
      findAll: vi.fn(() => Promise.resolve([eagerCharacter])),
    } as unknown as ThreadRevivalDeps["characters"],
    castResolver: {
      resolveRespondingCasts: vi.fn(() => Promise.resolve([eagerCharacter])),
    } as unknown as ThreadRevivalDeps["castResolver"],
    posts: {
      findById: vi.fn(() => Promise.resolve(dormantPost)),
      findDormantThreadRoots: vi.fn(() => Promise.resolve([dormantPost])),
      findUsersByIds: vi.fn(() => Promise.resolve([])),
      publish: vi.fn(() => Promise.resolve(revivedPost)),
    } as unknown as ThreadRevivalDeps["posts"],
    threads: {
      getCurrentThread: vi.fn(() =>
        Promise.resolve({ target: dormantPost, posts: [dormantPost] }),
      ),
    } as unknown as ThreadRevivalDeps["threads"],
    agents: {
      generate: vi.fn(() =>
        Promise.resolve({
          content: "Let me revive this!",
          action: "reply",
          providerId: "mock",
          model: "test",
        }),
      ),
    } as unknown as ThreadRevivalDeps["agents"],
    clock: () => now,
    rng: () => 0.1, // always below revivalWeight for eager (0.4)
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("reviveThread", () => {
  it("returns skipped when the room is archived", async () => {
    const deps = makeDeps({
      simulations: {
        findById: vi.fn(() => Promise.resolve({ ...room, status: "archived" })),
      } as unknown as ThreadRevivalDeps["simulations"],
    });

    const result = await reviveThread("room-1", deps);

    expect(result.outcome).toBe("skipped");
    expect((result as { outcome: "skipped"; reason: string }).reason).toContain("archived");
  });

  it("returns skipped when the room does not exist", async () => {
    const deps = makeDeps({
      simulations: {
        findById: vi.fn(() => Promise.resolve(null)),
      } as unknown as ThreadRevivalDeps["simulations"],
    });

    const result = await reviveThread("room-1", deps);

    expect(result.outcome).toBe("skipped");
  });

  it("returns skipped when no dormant threads exist", async () => {
    const deps = makeDeps({
      posts: {
        findDormantThreadRoots: vi.fn(() => Promise.resolve([])),
        findUsersByIds: vi.fn(() => Promise.resolve([])),
        publish: vi.fn(),
      } as unknown as ThreadRevivalDeps["posts"],
    });

    const result = await reviveThread("room-1", deps);

    expect(result.outcome).toBe("skipped");
    expect((result as { outcome: "skipped"; reason: string }).reason).toContain("no dormant threads");
  });

  it("returns skipped when no active Cast members exist", async () => {
    const deps = makeDeps({
      castResolver: {
        resolveRespondingCasts: vi.fn(() => Promise.resolve([])),
      } as unknown as ThreadRevivalDeps["castResolver"],
    });

    const result = await reviveThread("room-1", deps);

    expect(result.outcome).toBe("skipped");
    expect((result as { outcome: "skipped"; reason: string }).reason).toContain("no active Cast");
  });

  it("returns skipped when no character is willing to revive (rng always above revivalWeight)", async () => {
    const deps = makeDeps({
      rng: () => 0.99, // always above any revivalWeight
    });

    const result = await reviveThread("room-1", deps);

    expect(result.outcome).toBe("skipped");
    expect((result as { outcome: "skipped"; reason: string }).reason).toContain("no character willing");
  });

  it("returns revived when an eager character successfully posts", async () => {
    const deps = makeDeps();

    const result = await reviveThread("room-1", deps);

    expect(result.outcome).toBe("revived");
    expect((result as { outcome: "revived"; characterId: string; postId: string }).characterId).toBe(
      eagerCharacter.id,
    );
    expect((result as { outcome: "revived"; characterId: string; postId: string }).postId).toBe(
      revivedPost.id,
    );
    expect(deps.agents.generate).toHaveBeenCalledWith(expect.objectContaining({ action: "reply" }));
    expect(deps.posts.publish).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: dormantPost.id, quoteOf: null }),
    );
  });

  it("revives the thread root selected by the scheduled event", async () => {
    const selected = { ...dormantPost, id: "post-selected", threadRootId: "post-selected" };
    const findById = vi.fn(() => Promise.resolve(selected));
    const findDormantThreadRoots = vi.fn(() => Promise.resolve([dormantPost]));
    const getCurrentThread = vi.fn(() =>
      Promise.resolve({ target: selected, posts: [selected] }),
    );
    const deps = makeDeps({
      targetPostId: selected.id,
      posts: {
        findById,
        findDormantThreadRoots,
        findUsersByIds: vi.fn(() => Promise.resolve([])),
        publish: vi.fn(() => Promise.resolve({ ...revivedPost, replyTo: selected.id })),
      } as unknown as ThreadRevivalDeps["posts"],
      threads: { getCurrentThread } as unknown as ThreadRevivalDeps["threads"],
    });

    await reviveThread("room-1", deps);

    expect(findById).toHaveBeenCalledWith(selected.id);
    expect(findDormantThreadRoots).not.toHaveBeenCalled();
    expect(getCurrentThread).toHaveBeenCalledWith(selected.id);
  });

  it("skips a scheduled target that is no longer dormant", async () => {
    const deps = makeDeps({
      targetPostId: dormantPost.id,
      posts: {
        findById: vi.fn(() => Promise.resolve({ ...dormantPost, threadActivityAt: now })),
        findDormantThreadRoots: vi.fn(),
      } as unknown as ThreadRevivalDeps["posts"],
    });

    const result = await reviveThread("room-1", deps);

    expect(result).toEqual({
      outcome: "skipped",
      reason: "scheduled target is not a dormant thread root",
    });
  });

  it("calls findDormantThreadRoots with the correct dormant threshold", async () => {
    const findDormantThreadRoots = vi.fn(
      (_roomId: string, _dormantBefore: Date, _limit: number) => Promise.resolve([]),
    );
    const deps = makeDeps({
      posts: {
        findDormantThreadRoots,
        findUsersByIds: vi.fn(() => Promise.resolve([])),
        publish: vi.fn(),
      } as unknown as ThreadRevivalDeps["posts"],
    });

    await reviveThread("room-1", deps);

    expect(findDormantThreadRoots).toHaveBeenCalledWith(
      "room-1",
      expect.any(Date),
      expect.any(Number),
    );
    // The dormantBefore date should be now - DORMANT_THRESHOLD_MS
    const [, dormantBefore] = findDormantThreadRoots.mock.calls[0]!;
    expect(dormantBefore.getTime()).toBe(now.getTime() - DORMANT_THRESHOLD_MS);
  });

  it("returns error when the agent fails to generate", async () => {
    const deps = makeDeps({
      agents: {
        generate: vi.fn(() => Promise.reject(new Error("LLM timeout"))),
      } as unknown as ThreadRevivalDeps["agents"],
    });

    const result = await reviveThread("room-1", deps);

    expect(result.outcome).toBe("error");
    expect((result as { outcome: "error"; reason: string }).reason).toContain("LLM timeout");
  });

  it("returns skipped when thread context is unavailable", async () => {
    const deps = makeDeps({
      threads: {
        getCurrentThread: vi.fn(() => Promise.resolve(null)),
      } as unknown as ThreadRevivalDeps["threads"],
    });

    const result = await reviveThread("room-1", deps);

    expect(result.outcome).toBe("skipped");
    expect((result as { outcome: "skipped"; reason: string }).reason).toContain("thread context");
  });

  it("prefers the most recently active dormant thread (first in list)", async () => {
    const olderPost: Post = {
      ...dormantPost,
      id: "post-older",
      threadActivityAt: new Date(dormantAt.getTime() - 60_000),
    };
    const findDormantThreadRoots = vi.fn(() => Promise.resolve([dormantPost, olderPost]));
    const getCurrentThread = vi.fn(() =>
      Promise.resolve({ target: dormantPost, posts: [dormantPost] }),
    );
    const deps = makeDeps({
      posts: {
        findDormantThreadRoots,
        findUsersByIds: vi.fn(() => Promise.resolve([])),
        publish: vi.fn(() => Promise.resolve(revivedPost)),
      } as unknown as ThreadRevivalDeps["posts"],
      threads: { getCurrentThread } as unknown as ThreadRevivalDeps["threads"],
    });

    await reviveThread("room-1", deps);

    // getCurrentThread should be called with the first (most recent) dormant post
    expect(getCurrentThread).toHaveBeenCalledWith(dormantPost.id);
  });

  it("uses the injected clock to compute the dormant threshold", async () => {
    const customNow = new Date("2026-01-01T00:00:00.000Z");
    const findDormantThreadRoots = vi.fn(
      (_roomId: string, _dormantBefore: Date, _limit: number) => Promise.resolve([]),
    );
    const deps = makeDeps({
      clock: () => customNow,
      posts: {
        findDormantThreadRoots,
        findUsersByIds: vi.fn(() => Promise.resolve([])),
        publish: vi.fn(),
      } as unknown as ThreadRevivalDeps["posts"],
    });

    await reviveThread("room-1", deps);

    const [, dormantBefore] = findDormantThreadRoots.mock.calls[0]!;
    expect(dormantBefore.getTime()).toBe(customNow.getTime() - DORMANT_THRESHOLD_MS);
  });
});
