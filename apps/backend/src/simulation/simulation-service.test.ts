import { USER_AUTHOR_ID, type PostDto, type SseEvent } from "@brickr/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentService, GenerateRequest, GeneratedPost } from "../agents/agent-service.js";
import type { CharacterRepository } from "../characters/character-repository.js";
import type { Character } from "../characters/character.js";
import type { Post } from "../posts/post.js";
import type { PostService, PublishInput } from "../posts/post-service.js";
import type { ThreadContext, ThreadService } from "../posts/thread-service.js";
import { EventHub } from "./event-hub.js";
import type { SimulationRepository } from "./simulation-repository.js";
import {
  SimulationForbiddenError,
  SimulationService,
  type SimulationActor,
  type SimulationLogger,
} from "./simulation-service.js";
import type { Simulation } from "./simulation.js";

const SIMULATION: Simulation = {
  id: "sim-1",
  title: "test",
  status: "active",
  createdAt: new Date("2026-01-01T00:00:00Z"),
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
  generate?: (request: GenerateRequest) => Promise<GeneratedPost>;
  maxConcurrentCharacters?: number;
  maxCascadeDepth?: number;
};

type Harness = {
  service: SimulationService;
  events: EventHub;
  posts: Post[];
  generationCalls: GenerateRequest[];
  threadSnapshots: Array<{ targetId: string; postIds: string[] }>;
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
  let nextPostId = 1;

  const simulationRepository = {
    create: (): Promise<Simulation> => Promise.resolve(SIMULATION),
    findById: (id: string): Promise<Simulation | null> =>
      Promise.resolve(id === SIMULATION.id ? SIMULATION : null),
    updateStatus: (_id: string, status: Simulation["status"]): Promise<Simulation> =>
      Promise.resolve({ ...SIMULATION, status }),
    updateTitle: (_id: string, title: string): Promise<Simulation> =>
      Promise.resolve({ ...SIMULATION, title }),
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
      authorId: post.authorId,
      author:
        post.authorId === USER_AUTHOR_ID
          ? {
              id: USER_AUTHOR_ID,
              kind: "user",
              handle: "you",
              displayName: "あなた",
            }
          : {
              id: post.authorId,
              kind: "character",
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
      const post: Post = {
        id: `post-${String(nextPostId)}`,
        simulationId: input.simulationId,
        authorId: input.authorId,
        content: input.content,
        mentions: knownMentions(input.content, options.characters),
        replyTo: input.replyTo ?? null,
        quoteOf: input.quoteOf ?? null,
        createdAt: new Date(`2026-01-01T00:00:${String(nextPostId).padStart(2, "0")}Z`),
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
  );

  return { service, events, posts, generationCalls, threadSnapshots };
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
