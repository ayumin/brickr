import { GLOBAL_SIMULATION_ID, type PostDto } from "@brickr/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentService, GenerateRequest, GeneratedPost } from "../agents/agent-service.js";
import type { CharacterRepository } from "../characters/character-repository.js";
import type { Character } from "../characters/character.js";
import type { TokenUsageService } from "../llm/token-usage-service.js";
import type { Post } from "../posts/post.js";
import type { PostService, PublishInput } from "../posts/post-service.js";
import type { ThreadContext, ThreadService } from "../posts/thread-service.js";
import { EventHub } from "./event-hub.js";
import type { SimulationRepository } from "./simulation-repository.js";
import {
  GlobalSimulationMutationError,
  SimulationForbiddenError,
  SimulationService,
  type SimulationActor,
  type SimulationLogger,
} from "./simulation-service.js";
import type { Simulation } from "./simulation.js";

/**
 * The signed-in person who starts every submission in these tests. A UUID, not
 * the retired `you` singleton: posting always belongs to a real account (§8.2).
 */
const USER_AUTHOR_ID = "11111111-1111-4111-8111-111111111111";

const SIMULATION: Simulation = {
  id: "sim-1",
  title: "test",
  status: "active",
  scope: "room",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  lastActivityAt: new Date("2026-01-01T00:00:00Z"),
  createdByUserId: USER_AUTHOR_ID,
};

const OWNER: SimulationActor = { id: USER_AUTHOR_ID, isAdmin: false };

function makeCharacter(id: string, overrides: Partial<Character> = {}): Character {
  return {
    id,
    handle: id,
    displayName: id.toUpperCase(),
    description: `${id} description`,
    rolePrompt: `${id} role`,
    tonePrompt: `${id} tone`,
    interests: [],
    activityLevel: 0.5,
    responseProbability: 0,
    replyProbability: 1,
    quoteProbability: 0,
    influence: 0,
    modelProfileId: "test-profile",
    ...overrides,
  };
}

type HarnessOptions = {
  characters: Character[];
  /** Defaults to an ordinary room owned by `USER_AUTHOR_ID`. */
  simulation?: Simulation;
  generate?: (request: GenerateRequest) => Promise<GeneratedPost>;
  maxConcurrentCharacters?: number;
  maxCascadeDepth?: number;
  /** Defaults to pushing onto `tokenUsageRecords`; override to simulate a recording failure. */
  recordTokenUsage?: (userId: string, usage: NonNullable<GeneratedPost["usage"]>) => Promise<void>;
};

type TokenUsageRecord = { userId: string; usage: NonNullable<GeneratedPost["usage"]> };

type Harness = {
  service: SimulationService;
  events: EventHub;
  posts: Post[];
  generationCalls: GenerateRequest[];
  threadSnapshots: Array<{ targetId: string; postIds: string[] }>;
  tokenUsageRecords: TokenUsageRecord[];
};

/**
 * In-memory boundary fakes for the orchestration service. These deliberately
 * model persistence as shared mutable state: a later thread read can observe a
 * post published by an earlier character, just as it would through PostgreSQL.
 */
function makeHarness(options: HarnessOptions): Harness {
  const posts: Post[] = [];
  const generationCalls: GenerateRequest[] = [];
  const threadSnapshots: Array<{ targetId: string; postIds: string[] }> = [];
  const tokenUsageRecords: TokenUsageRecord[] = [];
  let nextPostId = 1;

  const simulation = options.simulation ?? SIMULATION;

  const simulationRepository = {
    create: (): Promise<Simulation> => Promise.resolve(simulation),
    findById: (id: string): Promise<Simulation | null> =>
      Promise.resolve(id === simulation.id ? simulation : null),
    updateStatus: (_id: string, status: Simulation["status"]): Promise<Simulation> =>
      Promise.resolve({ ...simulation, status }),
    updateTitle: (_id: string, title: string): Promise<Simulation> =>
      Promise.resolve({ ...simulation, title }),
  } as unknown as SimulationRepository;

  const characterRepository = {
    findAll: (): Promise<Character[]> => Promise.resolve(options.characters),
  } as unknown as CharacterRepository;

  const authorById = new Map(options.characters.map((character) => [character.id, character]));

  const toDto = (post: Post): PostDto => {
    const character = authorById.get(post.authorId);
    return {
      id: post.id,
      simulationId: post.simulationId,
      // One shape for both: nothing in a public post says whether its author is
      // a person or a character (§9.1).
      author:
        post.authorId === USER_AUTHOR_ID
          ? { id: USER_AUTHOR_ID, handle: "hanako", displayName: "花子" }
          : {
              id: post.authorId,
              handle: character?.handle ?? post.authorId,
              displayName: character?.displayName ?? post.authorId,
            },
      content: post.content,
      mentions: post.mentions,
      replyTo: post.replyTo,
      quoteOf: post.quoteOf,
      quotedPost: null,
      createdAt: post.createdAt.toISOString(),
    };
  };

  const postService = {
    publish(input: PublishInput): Promise<Post> {
      const id = `post-${String(nextPostId)}`;
      const createdAt = new Date(`2026-01-01T00:00:${String(nextPostId).padStart(2, "0")}Z`);
      const parent = input.replyTo
        ? posts.find((candidate) => candidate.id === input.replyTo)
        : undefined;
      const post: Post = {
        id,
        simulationId: input.simulationId,
        authorId: input.authorId,
        content: input.content,
        mentions: knownMentions(input.content, options.characters),
        replyTo: input.replyTo ?? null,
        quoteOf: input.quoteOf ?? null,
        // Mirrors the real service: a reply joins its parent's thread, anything
        // else — a quote repost included — starts its own (§8.3).
        threadRootId: parent?.threadRootId ?? id,
        threadActivityAt: createdAt,
        createdAt,
      };
      nextPostId += 1;
      posts.push(post);
      return Promise.resolve(post);
    },
    findById(id: string): Promise<Post | null> {
      return Promise.resolve(posts.find((post) => post.id === id) ?? null);
    },
    toDto(post: Post): Promise<PostDto> {
      return Promise.resolve(toDto(post));
    },
    listBySimulation(simulationId: string): Promise<PostDto[]> {
      return Promise.resolve(
        posts.filter((post) => post.simulationId === simulationId).map(toDto),
      );
    },
    // These tests have no user accounts: characters supply every handle in the
    // transcript, so an empty result is the honest answer.
    findUsersByIds(): Promise<[]> {
      return Promise.resolve([]);
    },
  } as unknown as PostService;

  const threadService = {
    getCurrentThread(targetId: string): Promise<ThreadContext | null> {
      const target = posts.find((post) => post.id === targetId);
      if (!target) return Promise.resolve(null);
      const visible = [...posts];
      threadSnapshots.push({ targetId, postIds: visible.map((post) => post.id) });
      return Promise.resolve({ target, posts: visible });
    },
  } as unknown as ThreadService;

  const agentService = {
    async generate(request: GenerateRequest): Promise<GeneratedPost> {
      generationCalls.push(request);
      if (options.generate) return options.generate(request);
      return {
        content: `${request.character.id} generated`,
        action: request.action,
        providerId: "mock",
        model: "test-model",
      };
    },
  } as unknown as AgentService;

  const logger: SimulationLogger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };

  const tokenUsage = {
    record: (userId: string, usage: NonNullable<GeneratedPost["usage"]>): Promise<void> => {
      if (options.recordTokenUsage) return options.recordTokenUsage(userId, usage);
      tokenUsageRecords.push({ userId, usage });
      return Promise.resolve();
    },
  } as unknown as TokenUsageService;

  const events = new EventHub();
  const service = new SimulationService(
    simulationRepository,
    postService,
    characterRepository,
    threadService,
    agentService,
    events,
    {
      // Tests choose responders explicitly. No opportunistic initial responders.
      minResponders: 0,
      maxResponders: 0,
      maxConcurrentCharacters: options.maxConcurrentCharacters ?? 1,
      maxCascadeDepth: options.maxCascadeDepth ?? 0,
    },
    logger,
    tokenUsage,
  );

  return { service, events, posts, generationCalls, threadSnapshots, tokenUsageRecords };
}

function knownMentions(content: string, characters: Character[]): string[] {
  const known = new Set(characters.map((character) => character.handle.toLowerCase()));
  return [...content.matchAll(/@([A-Za-z0-9_]{1,32})/gu)]
    .map((match) => (match[1] ?? "").toLowerCase())
    .filter((handle, index, all) => known.has(handle) && all.indexOf(handle) === index);
}

function collectUntilCompleted(events: EventHub): {
  received: SseEvent[];
  completed: Promise<Extract<SseEvent, { type: "simulation.completed" }>>;
} {
  const received: SseEvent[] = [];
  let resolveCompleted:
    | ((event: Extract<SseEvent, { type: "simulation.completed" }>) => void)
    | undefined;
  const completed = new Promise<Extract<SseEvent, { type: "simulation.completed" }>>(
    (resolve) => {
      resolveCompleted = resolve;
    },
  );

  events.subscribe(SIMULATION.id, (event) => {
    received.push(event);
    if (event.type === "simulation.completed") resolveCompleted?.(event);
  });

  return { received, completed };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SimulationService orchestration", () => {
  it("persists and streams the user post before generating the character response", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const alpha = makeCharacter("alpha");
    const harness = makeHarness({ characters: [alpha] });
    const stream = collectUntilCompleted(harness.events);

    const userPost = await harness.service.submitUserPost({
      simulationId: SIMULATION.id,
      authorId: USER_AUTHOR_ID,
      content: "hello",
      responderIds: [alpha.id],
    });
    const completed = await stream.completed;

    expect(harness.posts.map((post) => post.authorId)).toEqual([USER_AUTHOR_ID, alpha.id]);
    expect(harness.generationCalls).toHaveLength(1);
    expect(harness.generationCalls[0]?.target.id).toBe(userPost.id);
    expect(stream.received.map((event) => event.type)).toEqual([
      "post.created",
      "character.processing",
      "post.created",
      "simulation.completed",
    ]);
    expect(stream.received).toContainEqual(
      expect.objectContaining({
        type: "character.processing",
        targetPostId: userPost.id,
        characterId: alpha.id,
      }),
    );
    expect(completed.generatedPostIds).toEqual(["post-2"]);
  });

  it("lets a later character see a post persisted by an earlier character", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const alpha = makeCharacter("alpha");
    const beta = makeCharacter("beta");
    const harness = makeHarness({
      characters: [alpha, beta],
      maxConcurrentCharacters: 1,
    });
    const stream = collectUntilCompleted(harness.events);

    await harness.service.submitUserPost({
      simulationId: SIMULATION.id,
      authorId: USER_AUTHOR_ID,
      content: "hello",
      responderIds: [alpha.id, beta.id],
    });
    await stream.completed;

    expect(harness.generationCalls.map((call) => call.character.id)).toEqual([
      alpha.id,
      beta.id,
    ]);
    expect(harness.threadSnapshots[0]?.postIds).toEqual(["post-1"]);
    expect(harness.threadSnapshots[1]?.postIds).toEqual(["post-1", "post-2"]);
    expect(harness.generationCalls[1]?.posts.map((post) => post.authorId)).toEqual([
      USER_AUTHOR_ID,
      alpha.id,
    ]);
  });

  it("isolates one character failure and continues the other character", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const broken = makeCharacter("broken");
    const healthy = makeCharacter("healthy");
    const harness = makeHarness({
      characters: [broken, healthy],
      generate: (request) => {
        if (request.character.id === broken.id) {
          return Promise.reject(new Error("provider unavailable"));
        }
        return Promise.resolve({
          content: "healthy generated",
          action: request.action,
          providerId: "mock",
          model: "test-model",
        });
      },
    });
    const stream = collectUntilCompleted(harness.events);

    await harness.service.submitUserPost({
      simulationId: SIMULATION.id,
      authorId: USER_AUTHOR_ID,
      content: "hello",
      responderIds: [broken.id, healthy.id],
    });
    await stream.completed;

    expect(harness.posts.map((post) => post.authorId)).toEqual([
      USER_AUTHOR_ID,
      healthy.id,
    ]);
    expect(stream.received).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "character.failed",
          characterId: broken.id,
          reason: "provider unavailable",
        }),
        expect.objectContaining({ type: "simulation.completed" }),
      ]),
    );
  });

  it("cascades from a generated mention using that character post as the next target", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const alpha = makeCharacter("alpha");
    const beta = makeCharacter("beta");
    const harness = makeHarness({
      characters: [alpha, beta],
      maxCascadeDepth: 1,
      generate: (request) =>
        Promise.resolve({
          content:
            request.character.id === alpha.id ? "@beta what do you think?" : "beta reply",
          action: request.action,
          providerId: "mock",
          model: "test-model",
        }),
    });
    const stream = collectUntilCompleted(harness.events);

    await harness.service.submitUserPost({
      simulationId: SIMULATION.id,
      authorId: USER_AUTHOR_ID,
      content: "hello",
      responderIds: [alpha.id],
    });
    const completed = await stream.completed;

    expect(harness.generationCalls.map((call) => call.character.id)).toEqual([
      alpha.id,
      beta.id,
    ]);
    expect(harness.generationCalls[1]?.target.id).toBe("post-2");
    expect(harness.posts[2]).toMatchObject({ authorId: beta.id });
    expect(stream.received).toContainEqual(
      expect.objectContaining({
        type: "character.processing",
        targetPostId: "post-2",
        characterId: beta.id,
      }),
    );
    expect(completed.generatedPostIds).toEqual(["post-2", "post-3"]);
  });

  it("accepts new posts again after a stopped simulation is resumed", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const alpha = makeCharacter("alpha");
    const harness = makeHarness({ characters: [alpha] });

    const stopped = await harness.service.stop(SIMULATION.id, OWNER);
    expect(stopped.status).toBe("stopped");

    const resumed = await harness.service.resume(SIMULATION.id, OWNER);
    expect(resumed.status).toBe("active");

    const stream = collectUntilCompleted(harness.events);
    await harness.service.submitUserPost({
      simulationId: SIMULATION.id,
      authorId: USER_AUTHOR_ID,
      content: "hello again",
      responderIds: [alpha.id],
    });
    await stream.completed;

    expect(harness.posts.map((post) => post.authorId)).toEqual([
      USER_AUTHOR_ID,
      alpha.id,
    ]);
  });
});

describe("SimulationService ownership (CLAUDE.md §66.6)", () => {
  const ADMIN: SimulationActor = { id: "admin-1", isAdmin: true };
  const OTHER_USER: SimulationActor = { id: "someone-else", isAdmin: false };

  it("lets the creator stop, resume and rename their own simulation", async () => {
    const harness = makeHarness({ characters: [makeCharacter("alpha")] });

    await expect(harness.service.stop(SIMULATION.id, OWNER)).resolves.toMatchObject({
      status: "stopped",
    });
    await expect(harness.service.resume(SIMULATION.id, OWNER)).resolves.toMatchObject({
      status: "active",
    });
    await expect(
      harness.service.rename(SIMULATION.id, "new title", OWNER),
    ).resolves.toMatchObject({ title: "new title" });
  });

  it("lets an admin manage a simulation created by someone else", async () => {
    const harness = makeHarness({ characters: [makeCharacter("alpha")] });

    await expect(harness.service.stop(SIMULATION.id, ADMIN)).resolves.toMatchObject({
      status: "stopped",
    });
  });

  it("rejects a signed-in caller who did not create the simulation", async () => {
    const harness = makeHarness({ characters: [makeCharacter("alpha")] });

    await expect(harness.service.stop(SIMULATION.id, OTHER_USER)).rejects.toBeInstanceOf(
      SimulationForbiddenError,
    );
    await expect(harness.service.resume(SIMULATION.id, OTHER_USER)).rejects.toBeInstanceOf(
      SimulationForbiddenError,
    );
    await expect(
      harness.service.rename(SIMULATION.id, "new title", OTHER_USER),
    ).rejects.toBeInstanceOf(SimulationForbiddenError);
  });
});

/**
 * The reserved global simulation is the feed. Managing it as a room would break
 * every screen at once, so it is refused in the service rather than only in the
 * UI, which an API call goes straight past (§8.2).
 */
describe("SimulationService global feed protection (§8.2)", () => {
  const GLOBAL: Simulation = {
    id: GLOBAL_SIMULATION_ID,
    title: "フィード",
    status: "active",
    scope: "global",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastActivityAt: new Date("2026-01-01T00:00:00Z"),
  };

  const ADMIN: SimulationActor = { id: "admin-1", isAdmin: true };

  it("refuses rename, stop and resume — for an admin too, since it has no owner", async () => {
    const harness = makeHarness({ characters: [makeCharacter("alpha")], simulation: GLOBAL });

    await expect(harness.service.rename(GLOBAL.id, "世界", ADMIN)).rejects.toBeInstanceOf(
      GlobalSimulationMutationError,
    );
    await expect(harness.service.stop(GLOBAL.id, ADMIN)).rejects.toBeInstanceOf(
      GlobalSimulationMutationError,
    );
    await expect(harness.service.resume(GLOBAL.id, ADMIN)).rejects.toBeInstanceOf(
      GlobalSimulationMutationError,
    );
  });

  it("still accepts posts, because posting into the feed is the point of the row", async () => {
    const harness = makeHarness({ characters: [makeCharacter("alpha")], simulation: GLOBAL });

    const post = await harness.service.submitUserPost({
      simulationId: GLOBAL.id,
      authorId: USER_AUTHOR_ID,
      content: "フィードへの投稿",
      responderIds: [],
    });

    expect(post.simulationId).toBe(GLOBAL.id);
    expect(post.threadRootId).toBe(post.id);
  });
});

describe("SimulationService token usage (CLAUDE.md §66.4)", () => {
  const USAGE = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };

  it("bills every generation from one submission to the user who posted it, including cascades", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const alpha = makeCharacter("alpha");
    const beta = makeCharacter("beta");
    const harness = makeHarness({
      characters: [alpha, beta],
      maxCascadeDepth: 1,
      generate: (request) =>
        Promise.resolve({
          content:
            request.character.id === alpha.id ? "@beta what do you think?" : "beta reply",
          action: request.action,
          providerId: "mock",
          model: "test-model",
          usage: USAGE,
        }),
    });
    const stream = collectUntilCompleted(harness.events);

    await harness.service.submitUserPost({
      simulationId: SIMULATION.id,
      authorId: USER_AUTHOR_ID,
      content: "hello",
      responderIds: [alpha.id],
    });
    await stream.completed;

    // alpha's reply and beta's cascaded reply both trace back to the same
    // human submission, so both are billed to that human — not to alpha.
    expect(harness.tokenUsageRecords).toEqual([
      { userId: USER_AUTHOR_ID, usage: USAGE },
      { userId: USER_AUTHOR_ID, usage: USAGE },
    ]);
  });

  it("records nothing when the provider does not report usage", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const alpha = makeCharacter("alpha");
    const harness = makeHarness({ characters: [alpha] });
    const stream = collectUntilCompleted(harness.events);

    await harness.service.submitUserPost({
      simulationId: SIMULATION.id,
      authorId: USER_AUTHOR_ID,
      content: "hello",
      responderIds: [alpha.id],
    });
    await stream.completed;

    expect(harness.tokenUsageRecords).toEqual([]);
  });

  it("does not turn a successful response into character.failed when recording usage throws", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const alpha = makeCharacter("alpha");
    const harness = makeHarness({
      characters: [alpha],
      generate: (request) =>
        Promise.resolve({
          content: "generated",
          action: request.action,
          providerId: "mock",
          model: "test-model",
          usage: USAGE,
        }),
      recordTokenUsage: () => Promise.reject(new Error("token_usages write failed")),
    });
    const stream = collectUntilCompleted(harness.events);

    await harness.service.submitUserPost({
      simulationId: SIMULATION.id,
      authorId: USER_AUTHOR_ID,
      content: "hello",
      responderIds: [alpha.id],
    });
    const completed = await stream.completed;

    expect(harness.posts.map((post) => post.authorId)).toEqual([USER_AUTHOR_ID, alpha.id]);
    expect(completed.generatedPostIds).toEqual(["post-2"]);
    expect(stream.received.map((event) => event.type)).not.toContain("character.failed");
  });
});
