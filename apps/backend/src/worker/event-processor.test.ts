import { describe, expect, it, vi } from "vitest";
import type { AgentService } from "../agents/agent-service.js";
import type { Character } from "../characters/character.js";
import type { Post } from "../posts/post.js";
import type { ScheduledEvent } from "../scheduled-events/scheduled-event.js";
import type { Room } from "../rooms/room.js";
import { processEvent, type EventProcessorDeps } from "./event-processor.js";

// Mock the thread revival and room review services so we can control their
// return values without needing to wire up all their dependencies.
vi.mock("../rooms/thread-revival-service.js", () => ({
  reviveThread: vi.fn(),
  DORMANT_THRESHOLD_MS: 2 * 60 * 60 * 1_000,
}));
vi.mock("../rooms/room-review-service.js", () => ({
  reviewRoom: vi.fn(),
}));

import { reviveThread } from "../rooms/thread-revival-service.js";
import { reviewRoom } from "../rooms/room-review-service.js";

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
  roomId: "room-1",
  authorId: "user-1",
  content: "hello",
  mentions: [],
  replyTo: null,
  quoteOf: null,
  threadRootId: "post-1",
  threadActivityAt: now,
  createdAt: now,
};

const room: Room = {
  id: "room-1",
  title: "Room",
  status: "active",
  visibility: "public",
  scope: "room",
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

type GenerateRequest = Parameters<AgentService["generate"]>[0];

function makeDeps(generate: (request: GenerateRequest) => Promise<unknown>) {
  const publish = vi.fn(() => Promise.resolve(triggerPost));
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const scheduledEventsCreate = vi.fn(() => Promise.resolve(null));
  const deps = {
    rooms: { findById: () => Promise.resolve(room) },
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
    castResolver: {
      resolveRespondingCasts: () => Promise.resolve([character]),
    },
    posts: {
      findById: () => Promise.resolve(triggerPost),
      findUsersByIds: () => Promise.resolve([]),
      findDormantThreadRoots: () => Promise.resolve([]),
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
    scheduledEvents: { create: scheduledEventsCreate },
    logger,
  } as unknown as EventProcessorDeps;
  return { deps, publish, logger, scheduledEventsCreate };
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

  it("uses the full character list to resolve handles for previous Cast authors", async () => {
    const departed = { ...character, id: "character-departed", handle: "former_cast" };
    const departedPost = {
      ...triggerPost,
      id: "post-departed",
      authorId: departed.id,
    };
    const resolvedHandles: string[] = [];
    const { deps } = makeDeps((request) => {
      resolvedHandles.push(request.resolveHandle(departed.id));
      return Promise.resolve({
        content: "reply",
        action: "reply",
        providerId: "mock",
        model: "test",
      });
    });
    deps.characters.findAll = vi.fn(() => Promise.resolve([character, departed]));
    deps.threads.getCurrentThread = vi.fn(() =>
      Promise.resolve({ target: triggerPost, posts: [departedPost, triggerPost] }),
    );

    await processEvent(event, deps);

    expect(resolvedHandles).toEqual(["former_cast"]);
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

describe("processEvent thread.revive", () => {
  const reviveEvent: ScheduledEvent = {
    ...event,
    type: "thread.revive",
    postId: triggerPost.id,
    threadRootId: triggerPost.id,
    characterId: null,
  };

  it("logs skipped when the revival service returns skipped", async () => {
    vi.mocked(reviveThread).mockResolvedValue({
      outcome: "skipped",
      reason: "no dormant threads found",
    });
    const { deps, logger } = makeDeps(() => Promise.resolve({}));

    await processEvent(reviveEvent, deps);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "no dormant threads found" }),
      "thread revival skipped",
    );
  });

  it("logs revived when the revival service returns revived", async () => {
    vi.mocked(reviveThread).mockResolvedValue({
      outcome: "revived",
      characterId: character.id,
      postId: "post-revived",
    });
    const { deps, logger } = makeDeps(() => Promise.resolve({}));

    await processEvent(reviveEvent, deps);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: character.id, postId: "post-revived" }),
      "thread revived",
    );
    expect(reviveThread).toHaveBeenCalledWith(
      "room-1",
      expect.objectContaining({ targetPostId: triggerPost.id }),
    );
  });

  it("throws when roomId is missing so the worker retries", async () => {
    const { deps } = makeDeps(() => Promise.resolve({}));

    await expect(
      processEvent({ ...reviveEvent, roomId: null }, deps),
    ).rejects.toThrow("thread.revive event event-1 is missing roomId");
  });

  it("throws when the revival service returns an error so the worker retries", async () => {
    vi.mocked(reviveThread).mockResolvedValue({
      outcome: "error",
      reason: "LLM down",
    });
    const { deps } = makeDeps(() => Promise.resolve({}));

    await expect(processEvent(reviveEvent, deps)).rejects.toThrow(
      /thread\.revive failed for event event-1/,
    );
  });
});

describe("processEvent room.review", () => {
  const reviewEvent: ScheduledEvent = {
    ...event,
    type: "room.review",
    postId: null,
    threadRootId: null,
    characterId: null,
  };

  it("logs skipped when the review service returns a skipped reason", async () => {
    vi.mocked(reviewRoom).mockResolvedValue({
      revivalsScheduled: 0,
      skippedReason: "room not found or archived",
    });
    const { deps, logger } = makeDeps(() => Promise.resolve({}));

    await processEvent(reviewEvent, deps);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "room not found or archived" }),
      "room review skipped",
    );
  });

  it("logs completed with revival count when the review service schedules revivals", async () => {
    vi.mocked(reviewRoom).mockResolvedValue({ revivalsScheduled: 2 });
    const { deps, logger } = makeDeps(() => Promise.resolve({}));

    await processEvent(reviewEvent, deps);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ revivalsScheduled: 2 }),
      "room review completed",
    );
  });

  it("throws when roomId is missing so the worker retries", async () => {
    const { deps } = makeDeps(() => Promise.resolve({}));

    await expect(
      processEvent({ ...reviewEvent, roomId: null }, deps),
    ).rejects.toThrow("room.review event event-1 is missing roomId");
  });
});
