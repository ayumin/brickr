import { describe, expect, it, vi } from "vitest";
import type { Character } from "../characters/character.js";
import type { Post } from "../posts/post.js";
import type { ScheduledEvent } from "../scheduled-events/scheduled-event.js";
import type { Simulation } from "../simulation/simulation.js";
import { processEvent, type EventProcessorDeps } from "./event-processor.js";

const now = new Date("2026-08-17T00:00:00.000Z");

const character: Character = {
  id: "character-1",
  handle: "responder",
  displayName: "Responder",
  description: "desc",
  rolePrompt: "role",
  tonePrompt: "tone",
  interests: [],
  activityLevel: 1,
  responseProbability: 1,
  replyProbability: 1,
  quoteProbability: 0,
  influence: 0,
  modelProfileId: "test-profile",
};

const triggerPost: Post = {
  id: "post-1",
  simulationId: "room-1",
  authorId: "user-1",
  content: "hello",
  mentions: [],
  replyTo: null,
  quoteOf: null,
  threadRootId: "post-1",
  threadActivityAt: now,
  createdAt: now,
};

const room: Simulation = {
  id: "room-1",
  title: "Room",
  status: "active",
  scope: "room",
  visibility: "public",
  tags: [],
  createdAt: now,
  lastActivityAt: now,
  createdByUserId: "user-1",
};

const event: ScheduledEvent = {
  id: "event-1",
  type: "character.respond",
  status: "processing",
  scheduledAt: now,
  roomId: room.id,
  postId: triggerPost.id,
  threadRootId: triggerPost.id,
  characterId: character.id,
  lockedBy: "worker-1",
  lockedAt: now,
  attempts: 1,
  lastError: null,
  createdAt: now,
  updatedAt: now,
};

function makeDeps(generate: () => Promise<unknown>) {
  const publish = vi.fn(() => Promise.resolve(triggerPost));
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const deps = {
    simulations: { findById: () => Promise.resolve(room) },
    characters: {
      findAll: () => Promise.resolve([character]),
      findById: () => Promise.resolve(character),
    },
    memberships: {
      findActiveCastIds: () => Promise.resolve([]),
      findPendingCastIds: () => Promise.resolve([]),
      findBannedCastIds: () => Promise.resolve([]),
      countPendingCasts: () => Promise.resolve(0),
      countActiveRoomsForCast: () => Promise.resolve(0),
      create: vi.fn(),
    },
    posts: {
      findById: () => Promise.resolve(triggerPost),
      findUsersByIds: () => Promise.resolve([]),
      publish,
    },
    threads: {
      getCurrentThread: () => Promise.resolve({ target: triggerPost, posts: [triggerPost] }),
    },
    agents: { generate },
    llm: {
      generate: () =>
        Promise.resolve({
          text: JSON.stringify({ shouldJoin: false, reason: "test" }),
          providerId: "mock",
          model: "test",
        }),
    },
    providers: { preferred: () => null },
    logger,
  } as unknown as EventProcessorDeps;
  return { deps, publish, logger };
}

describe("processEvent character.respond", () => {
  it("throws when every selected responder fails so the worker retries", async () => {
    const { deps, publish, logger } = makeDeps(() => Promise.reject(new Error("LLM down")));

    await expect(processEvent(event, deps)).rejects.toThrow(
      "all 1 responders failed for event event-1",
    );
    expect(publish).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("completes when a responder publishes successfully", async () => {
    const { deps, publish } = makeDeps(() =>
      Promise.resolve({ content: "reply", action: "reply", providerId: "mock", model: "test" }),
    );

    await expect(processEvent(event, deps)).resolves.toBeUndefined();
    expect(publish).toHaveBeenCalledTimes(1);
  });
});

describe("processEvent Cast join events", () => {
  it("logs join errors at warn level", async () => {
    const { deps, logger } = makeDeps(() => Promise.resolve({}));
    deps.providers.preferred = () => ({ id: "mock", defaultModel: "test" }) as never;
    deps.llm.generate = vi.fn().mockResolvedValue({
      text: JSON.stringify({ shouldJoin: true, reason: "good fit" }),
      providerId: "mock",
      model: "test",
    });
    deps.memberships.create = vi.fn().mockRejectedValue(new Error("database unavailable"));

    await processEvent(
      { ...event, type: "character.join.request", postId: null, threadRootId: null },
      deps,
    );

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "database unavailable" }),
      "cast join errored",
    );
  });

  it("logs a skipped welcome without claiming a post was published", async () => {
    const { deps, logger } = makeDeps(() => Promise.resolve({}));

    await processEvent(
      {
        ...event,
        type: "character.join.welcome",
        postId: null,
        threadRootId: null,
        characterId: character.id,
      },
      deps,
    );

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "no LLM provider available" }),
      "cast welcome post skipped",
    );
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.anything(),
      "cast welcome post published",
    );
  });
});
