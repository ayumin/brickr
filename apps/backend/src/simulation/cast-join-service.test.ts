/**
 * Tests for Cast recommendation, join-request, and welcome-event logic
 * (issue #164).
 *
 * Covers:
 *   - scoreCastForRoom: interests/tags matching and active-room penalty
 *   - askLlmShouldJoin: LLM structured judgment and safe-side fallback
 *   - processCastJoinRequests: visibility rules, ban exclusion, pending limit
 *   - publishWelcomePost: welcome post generation and non-fatal failure
 */

import { describe, expect, it, vi } from "vitest";
import type { Character } from "../characters/character.js";
import type { Simulation } from "./simulation.js";
import type { RoomMembership } from "./room-membership-repository.js";
import {
  scoreCastForRoom,
  askLlmShouldJoin,
  processCastJoinRequests,
  publishWelcomePost,
  type CastJoinServiceDeps,
} from "./cast-join-service.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = new Date("2026-08-17T00:00:00.000Z");

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: "char-1",
    handle: "testcast",
    displayName: "Test Cast",
    description: "A test character",
    rolePrompt: "You are a test character.",
    tonePrompt: "Speak casually.",
    interests: ["tech", "gaming"],
    activityLevel: 0.7,
    responseProbability: 0.8,
    replyProbability: 0.6,
    quoteProbability: 0.2,
    influence: 0.5,
    castAutonomous: true,
    modelProfileId: "profile-1",
    ...overrides,
  };
}

function makeRoom(overrides: Partial<Simulation> = {}): Simulation {
  return {
    id: "room-1",
    title: "Test Room",
    status: "active",
    visibility: "public",
    createdAt: now,
    lastActivityAt: now,
    createdByUserId: "user-1",
    tags: ["tech"],
    ...overrides,
  };
}

function makeMembership(overrides: Partial<RoomMembership> = {}): RoomMembership {
  return {
    id: "mem-1",
    roomId: "room-1",
    memberKind: "character",
    memberId: "char-1",
    role: "member",
    status: "active",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// scoreCastForRoom
// ---------------------------------------------------------------------------

describe("scoreCastForRoom", () => {
  it("returns 0 when there are no matching tags and no active rooms", () => {
    const character = makeCharacter({ interests: ["cooking"] });
    expect(scoreCastForRoom(character, ["tech"], 0)).toBe(0);
  });

  it("adds TAG_MATCH_WEIGHT (10) per matching interest", () => {
    const character = makeCharacter({ interests: ["tech", "gaming", "cooking"] });
    // "tech" and "gaming" match
    expect(scoreCastForRoom(character, ["tech", "gaming"], 0)).toBe(20);
  });

  it("subtracts ACTIVE_ROOM_PENALTY (2) per active room", () => {
    const character = makeCharacter({ interests: [] });
    expect(scoreCastForRoom(character, [], 5)).toBe(-10);
  });

  it("combines tag matches and active-room penalty", () => {
    const character = makeCharacter({ interests: ["tech"] });
    // 1 match × 10 − 3 rooms × 2 = 4
    expect(scoreCastForRoom(character, ["tech"], 3)).toBe(4);
  });

  it("returns 0 when room has no tags", () => {
    const character = makeCharacter({ interests: ["tech", "gaming"] });
    expect(scoreCastForRoom(character, [], 0)).toBe(0);
  });

  it("is case-sensitive: 'Tech' does not match 'tech'", () => {
    const character = makeCharacter({ interests: ["Tech"] });
    expect(scoreCastForRoom(character, ["tech"], 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// askLlmShouldJoin
// ---------------------------------------------------------------------------

describe("askLlmShouldJoin", () => {
  it("returns shouldJoin=false when no provider is available", async () => {
    const generate = vi.fn();
    const llm = { generate } as never;
    const providers = { preferred: () => null } as never;
    const character = makeCharacter();
    const room = makeRoom();

    const result = await askLlmShouldJoin(llm, providers, character, room);
    expect(result.shouldJoin).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });

  it("returns shouldJoin=true when LLM responds affirmatively", async () => {
    const llm = {
      generate: vi.fn().mockResolvedValue({
        text: JSON.stringify({ shouldJoin: true, reason: "good fit" }),
        providerId: "mock",
        model: "test",
      }),
    } as never;
    const providers = {
      preferred: () => ({ id: "mock", defaultModel: "test" }),
    } as never;

    const result = await askLlmShouldJoin(llm, providers, makeCharacter(), makeRoom());
    expect(result.shouldJoin).toBe(true);
    expect(result.reason).toBe("good fit");
  });

  it("returns shouldJoin=false when LLM responds negatively", async () => {
    const llm = {
      generate: vi.fn().mockResolvedValue({
        text: JSON.stringify({ shouldJoin: false, reason: "not a good fit" }),
        providerId: "mock",
        model: "test",
      }),
    } as never;
    const providers = {
      preferred: () => ({ id: "mock", defaultModel: "test" }),
    } as never;

    const result = await askLlmShouldJoin(llm, providers, makeCharacter(), makeRoom());
    expect(result.shouldJoin).toBe(false);
  });

  it("returns shouldJoin=false (safe-side) when LLM call throws", async () => {
    const llm = {
      generate: vi.fn().mockRejectedValue(new Error("LLM down")),
    } as never;
    const providers = {
      preferred: () => ({ id: "mock", defaultModel: "test" }),
    } as never;

    const result = await askLlmShouldJoin(llm, providers, makeCharacter(), makeRoom());
    expect(result.shouldJoin).toBe(false);
  });

  it("returns shouldJoin=false when LLM returns invalid JSON", async () => {
    const llm = {
      generate: vi.fn().mockResolvedValue({
        text: "not json at all",
        providerId: "mock",
        model: "test",
      }),
    } as never;
    const providers = {
      preferred: () => ({ id: "mock", defaultModel: "test" }),
    } as never;

    const result = await askLlmShouldJoin(llm, providers, makeCharacter(), makeRoom());
    expect(result.shouldJoin).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// processCastJoinRequests — helpers
// ---------------------------------------------------------------------------

/**
 * Builds a minimal CastJoinServiceDeps with sensible defaults.
 * Individual tests override only what they need.
 */
function makeDeps(overrides: Partial<CastJoinServiceDeps> = {}): CastJoinServiceDeps {
  const defaultCharacter = makeCharacter();
  const defaultRoom = makeRoom();

  const memberships = {
    findActiveCastIds: vi.fn().mockResolvedValue([]),
    findPendingCastIds: vi.fn().mockResolvedValue([]),
    findBannedCastIds: vi.fn().mockResolvedValue([]),
    countPendingCasts: vi.fn().mockResolvedValue(0),
    countActiveRoomsForCast: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockResolvedValue(makeMembership()),
  };

  const llm = {
    generate: vi.fn().mockResolvedValue({
      text: JSON.stringify({ shouldJoin: true, reason: "good fit" }),
      providerId: "mock",
      model: "test",
    }),
  };

  const providers = {
    preferred: () => ({ id: "mock", defaultModel: "test" }),
  };

  return {
    simulations: {
      findById: vi.fn().mockResolvedValue(defaultRoom),
    } as never,
    characters: {
      findAll: vi.fn().mockResolvedValue([defaultCharacter]),
    } as never,
    memberships: memberships as never,
    posts: {
      publish: vi.fn().mockResolvedValue({}),
    } as never,
    llm: llm as never,
    providers: providers as never,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// processCastJoinRequests — visibility rules
// ---------------------------------------------------------------------------

describe("processCastJoinRequests — public room", () => {
  it("creates an active membership immediately", async () => {
    const deps = makeDeps();
    const results = await processCastJoinRequests("room-1", deps);

    expect(results).toHaveLength(1);
    expect(results[0]?.outcome).toBe("joined");
    expect(deps.memberships.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: "active", memberKind: "character" }),
    );
  });
});

describe("processCastJoinRequests — open room", () => {
  it("creates a pending membership (owner approval required)", async () => {
    const deps = makeDeps({
      simulations: {
        findById: vi.fn().mockResolvedValue(makeRoom({ visibility: "open" })),
      } as never,
    });
    const results = await processCastJoinRequests("room-1", deps);

    expect(results).toHaveLength(1);
    expect(results[0]?.outcome).toBe("pending");
    expect(deps.memberships.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", memberKind: "character" }),
    );
  });
});

describe("processCastJoinRequests — closed room", () => {
  it("creates a pending membership (invitation-only, Cast may request)", async () => {
    const deps = makeDeps({
      simulations: {
        findById: vi.fn().mockResolvedValue(makeRoom({ visibility: "closed" })),
      } as never,
    });
    const results = await processCastJoinRequests("room-1", deps);

    expect(results).toHaveLength(1);
    expect(results[0]?.outcome).toBe("pending");
    expect(deps.memberships.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending" }),
    );
  });
});

describe("processCastJoinRequests — private room", () => {
  it("creates a pending membership (invitation-only, Cast may request)", async () => {
    const deps = makeDeps({
      simulations: {
        findById: vi.fn().mockResolvedValue(makeRoom({ visibility: "private" })),
      } as never,
    });
    const results = await processCastJoinRequests("room-1", deps);

    expect(results).toHaveLength(1);
    expect(results[0]?.outcome).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// processCastJoinRequests — ban exclusion
// ---------------------------------------------------------------------------

describe("processCastJoinRequests — ban exclusion", () => {
  it("skips banned characters", async () => {
    const character = makeCharacter({ id: "char-banned" });
    const deps = makeDeps({
      characters: { findAll: vi.fn().mockResolvedValue([character]) } as never,
      memberships: {
        findActiveCastIds: vi.fn().mockResolvedValue([]),
        findPendingCastIds: vi.fn().mockResolvedValue([]),
        findBannedCastIds: vi.fn().mockResolvedValue(["char-banned"]),
        countPendingCasts: vi.fn().mockResolvedValue(0),
        countActiveRoomsForCast: vi.fn().mockResolvedValue(0),
        create: vi.fn(),
      } as never,
    });

    const results = await processCastJoinRequests("room-1", deps);
    expect(results).toHaveLength(1);
    expect(results[0]?.outcome).toBe("skipped");
    expect(deps.memberships.create).not.toHaveBeenCalled();
  });

  it("skips characters that are already active members", async () => {
    const character = makeCharacter({ id: "char-active" });
    const deps = makeDeps({
      characters: { findAll: vi.fn().mockResolvedValue([character]) } as never,
      memberships: {
        findActiveCastIds: vi.fn().mockResolvedValue(["char-active"]),
        findPendingCastIds: vi.fn().mockResolvedValue([]),
        findBannedCastIds: vi.fn().mockResolvedValue([]),
        countPendingCasts: vi.fn().mockResolvedValue(0),
        countActiveRoomsForCast: vi.fn().mockResolvedValue(0),
        create: vi.fn(),
      } as never,
    });

    const results = await processCastJoinRequests("room-1", deps);
    expect(results).toHaveLength(1);
    expect(results[0]?.outcome).toBe("skipped");
    expect(deps.memberships.create).not.toHaveBeenCalled();
  });

  it("skips characters that already have a pending membership", async () => {
    const character = makeCharacter({ id: "char-pending" });
    const deps = makeDeps({
      characters: { findAll: vi.fn().mockResolvedValue([character]) } as never,
      memberships: {
        findActiveCastIds: vi.fn().mockResolvedValue([]),
        findPendingCastIds: vi.fn().mockResolvedValue(["char-pending"]),
        findBannedCastIds: vi.fn().mockResolvedValue([]),
        countPendingCasts: vi.fn().mockResolvedValue(1),
        countActiveRoomsForCast: vi.fn().mockResolvedValue(0),
        create: vi.fn(),
      } as never,
    });

    const results = await processCastJoinRequests("room-1", deps);

    expect(results).toEqual([{ outcome: "skipped", reason: "no eligible candidates" }]);
    expect(deps.llm.generate).not.toHaveBeenCalled();
    expect(deps.memberships.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// processCastJoinRequests — pending limit
// ---------------------------------------------------------------------------

describe("processCastJoinRequests — pending limit", () => {
  it("skips when the pending Cast limit (3) is already reached", async () => {
    const deps = makeDeps({
      memberships: {
        findActiveCastIds: vi.fn().mockResolvedValue([]),
        findPendingCastIds: vi.fn().mockResolvedValue([]),
        findBannedCastIds: vi.fn().mockResolvedValue([]),
        countPendingCasts: vi.fn().mockResolvedValue(3),
        countActiveRoomsForCast: vi.fn().mockResolvedValue(0),
        create: vi.fn(),
      } as never,
    });

    const results = await processCastJoinRequests("room-1", deps);
    expect(results).toHaveLength(1);
    const result = results[0];
    expect(result?.outcome).toBe("skipped");
    if (result?.outcome === "skipped") {
      expect(result.reason).toMatch(/pending Cast limit/i);
    }
    expect(deps.memberships.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// processCastJoinRequests — LLM wait fallback
// ---------------------------------------------------------------------------

describe("processCastJoinRequests — LLM wait fallback", () => {
  it("skips the candidate when LLM says shouldJoin=false", async () => {
    const deps = makeDeps({
      llm: {
        generate: vi.fn().mockResolvedValue({
          text: JSON.stringify({ shouldJoin: false, reason: "not a good fit" }),
          providerId: "mock",
          model: "test",
        }),
      } as never,
    });

    const results = await processCastJoinRequests("room-1", deps);
    expect(results).toHaveLength(1);
    expect(results[0]?.outcome).toBe("skipped");
    expect(deps.memberships.create).not.toHaveBeenCalled();
  });

  it("skips the candidate when LLM call fails (safe-side fallback)", async () => {
    const deps = makeDeps({
      llm: {
        generate: vi.fn().mockRejectedValue(new Error("LLM down")),
      } as never,
    });

    const results = await processCastJoinRequests("room-1", deps);
    expect(results).toHaveLength(1);
    expect(results[0]?.outcome).toBe("skipped");
    expect(deps.memberships.create).not.toHaveBeenCalled();
  });

  it("skips when no LLM provider is available", async () => {
    const deps = makeDeps({
      providers: { preferred: () => null } as never,
    });

    const results = await processCastJoinRequests("room-1", deps);
    expect(results).toHaveLength(1);
    expect(results[0]?.outcome).toBe("skipped");
    expect(deps.memberships.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// processCastJoinRequests — castAutonomous=false
// ---------------------------------------------------------------------------

describe("processCastJoinRequests — castAutonomous=false", () => {
  it("excludes characters with castAutonomous=false from the candidate pool", async () => {
    const character = makeCharacter({ castAutonomous: false });
    const deps = makeDeps({
      characters: { findAll: vi.fn().mockResolvedValue([character]) } as never,
    });

    const results = await processCastJoinRequests("room-1", deps);
    expect(results).toHaveLength(1);
    expect(results[0]?.outcome).toBe("skipped");
    expect(deps.memberships.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// processCastJoinRequests — archived room
// ---------------------------------------------------------------------------

describe("processCastJoinRequests — archived room", () => {
  it("skips when the room is archived", async () => {
    const deps = makeDeps({
      simulations: {
        findById: vi.fn().mockResolvedValue(makeRoom({ status: "archived" })),
      } as never,
    });

    const results = await processCastJoinRequests("room-1", deps);
    expect(results).toHaveLength(1);
    expect(results[0]?.outcome).toBe("skipped");
    expect(deps.memberships.create).not.toHaveBeenCalled();
  });

  it("skips when the room does not exist", async () => {
    const deps = makeDeps({
      simulations: {
        findById: vi.fn().mockResolvedValue(null),
      } as never,
    });

    const results = await processCastJoinRequests("room-1", deps);
    expect(results).toHaveLength(1);
    expect(results[0]?.outcome).toBe("skipped");
  });
});

// ---------------------------------------------------------------------------
// publishWelcomePost
// ---------------------------------------------------------------------------

describe("publishWelcomePost", () => {
  function makeWelcomeDeps(overrides: Partial<Parameters<typeof publishWelcomePost>[2]> = {}) {
    const character = makeCharacter();
    const room = makeRoom();

    return {
      simulations: {
        findById: vi.fn().mockResolvedValue(room),
      } as never,
      characters: {
        findById: vi.fn().mockResolvedValue(character),
      } as never,
      posts: {
        publish: vi.fn().mockResolvedValue({}),
      } as never,
      llm: {
        generate: vi.fn().mockResolvedValue({
          text: "こんにちは！よろしくお願いします。",
          providerId: "mock",
          model: "test",
        }),
      } as never,
      providers: {
        preferred: () => ({ id: "mock", defaultModel: "test" }),
      } as never,
      ...overrides,
    };
  }

  it("publishes a welcome post when the LLM generates content", async () => {
    const deps = makeWelcomeDeps();
    const result = await publishWelcomePost("room-1", "char-1", deps);

    expect(result).toEqual({ outcome: "published" });
    expect(deps.posts.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: "room-1",
        authorId: "char-1",
        content: "こんにちは！よろしくお願いします。",
      }),
    );
  });

  it("does not publish when the room is archived", async () => {
    const deps = makeWelcomeDeps({
      simulations: {
        findById: vi.fn().mockResolvedValue(makeRoom({ status: "archived" })),
      } as never,
    });
    const result = await publishWelcomePost("room-1", "char-1", deps);
    expect(result).toEqual({ outcome: "skipped", reason: "room not found or archived" });
    expect(deps.posts.publish).not.toHaveBeenCalled();
  });

  it("does not publish when the room does not exist", async () => {
    const deps = makeWelcomeDeps({
      simulations: { findById: vi.fn().mockResolvedValue(null) } as never,
    });
    const result = await publishWelcomePost("room-1", "char-1", deps);
    expect(result).toEqual({ outcome: "skipped", reason: "room not found or archived" });
    expect(deps.posts.publish).not.toHaveBeenCalled();
  });

  it("does not publish when the character does not exist", async () => {
    const deps = makeWelcomeDeps({
      characters: { findById: vi.fn().mockResolvedValue(null) } as never,
    });
    const result = await publishWelcomePost("room-1", "char-1", deps);
    expect(result).toEqual({ outcome: "skipped", reason: "character not found" });
    expect(deps.posts.publish).not.toHaveBeenCalled();
  });

  it("does not publish when no LLM provider is available", async () => {
    const deps = makeWelcomeDeps({
      providers: { preferred: () => null } as never,
    });
    const result = await publishWelcomePost("room-1", "char-1", deps);
    expect(result).toEqual({ outcome: "skipped", reason: "no LLM provider available" });
    expect(deps.posts.publish).not.toHaveBeenCalled();
  });

  it("does not throw when the LLM call fails (non-fatal)", async () => {
    const deps = makeWelcomeDeps({
      llm: {
        generate: vi.fn().mockRejectedValue(new Error("LLM down")),
      } as never,
    });
    await expect(publishWelcomePost("room-1", "char-1", deps)).resolves.toEqual({
      outcome: "error",
      reason: "LLM down",
    });
    expect(deps.posts.publish).not.toHaveBeenCalled();
  });

  it("does not publish when the LLM returns empty content", async () => {
    const deps = makeWelcomeDeps({
      llm: {
        generate: vi.fn().mockResolvedValue({
          text: "   ",
          providerId: "mock",
          model: "test",
        }),
      } as never,
    });
    const result = await publishWelcomePost("room-1", "char-1", deps);
    expect(result).toEqual({ outcome: "skipped", reason: "LLM returned empty content" });
    expect(deps.posts.publish).not.toHaveBeenCalled();
  });
});
