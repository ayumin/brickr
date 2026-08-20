import type { PostDto } from "@brickr/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentService, GenerateRequest, GeneratedPost } from "../agents/agent-service.js";
import type { CharacterRepository } from "../characters/character-repository.js";
import type { Character } from "../characters/character.js";
import type { TokenUsageService } from "../llm/token-usage-service.js";
import type { Post } from "../posts/post.js";
import type { PostService, PublishInput } from "../posts/post-service.js";
import type { ThreadContext, ThreadService } from "../posts/thread-service.js";
import { EventHub } from "./event-hub.js";
import type { InternalSseEvent, ThreadActivityEvent } from "./public-events.js";
import type { RoomRepository } from "./room-repository.js";
import type {
  CreateMembershipInput,
  RoomMembership,
  RoomMembershipRepository,
} from "./room-membership-repository.js";
import {
  PostNotFoundError,
  assertRoomReadable,
  RoomManageForbiddenError,
  RoomRuntimeService,
  type SignedInActor,
  type RoomRuntimeLogger,
} from "./room-runtime-service.js";
import { RoomNotFoundError } from "./room-errors.js";
import type { Room } from "./room.js";

/**
 * The signed-in person who starts every submission in these tests. A UUID, not
 * the retired `you` singleton: posting always belongs to a real account (§8.2).
 */
const USER_AUTHOR_ID = "11111111-1111-4111-8111-111111111111";

const ROOM: Room = {
  id: "sim-1",
  title: "test",
  status: "active",
  visibility: "public",
  scope: "room",
  tags: [],
  createdAt: new Date("2026-01-01T00:00:00Z"),
  lastActivityAt: new Date("2026-01-01T00:00:00Z"),
  createdByUserId: USER_AUTHOR_ID,
};

const OWNER: SignedInActor = { id: USER_AUTHOR_ID, isAdmin: false };

/** A membership repository that answers `findOne` from a fixed in-memory list. */
function makeMembershipsFake(rows: RoomMembership[] = []): RoomMembershipRepository {
  return {
    findOne: (roomId: string, memberKind: string, memberId: string) =>
      Promise.resolve(
        rows.find(
          (row) => row.roomId === roomId && row.memberKind === memberKind && row.memberId === memberId,
        ) ?? null,
      ),
  } as unknown as RoomMembershipRepository;
}

describe("assertRoomReadable — real membership lookup (issue #175)", () => {
  const nonOwner: SignedInActor = { id: "other-user", isAdmin: false };

  it("rejects a non-member from an active closed room", async () => {
    await expect(
      assertRoomReadable(makeMembershipsFake(), { ...ROOM, visibility: "closed" }, nonOwner),
    ).rejects.toThrow(RoomNotFoundError);
  });

  it("admits an active member of an active closed room", async () => {
    const memberships = makeMembershipsFake([
      {
        id: "mem-1",
        roomId: ROOM.id,
        memberKind: "user",
        memberId: nonOwner.id,
        role: "member",
        status: "active",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
    await expect(
      assertRoomReadable(memberships, { ...ROOM, visibility: "closed" }, nonOwner),
    ).resolves.not.toThrow();
  });

  it("continues to hide an archived room from a non-owner", async () => {
    await expect(
      assertRoomReadable(
        makeMembershipsFake(),
        { ...ROOM, visibility: "closed", status: "archived" },
        nonOwner,
      ),
    ).rejects.toThrow(RoomNotFoundError);
  });

  it("still admits the legacy owner (no membership row, createdByUserId match)", async () => {
    await expect(
      assertRoomReadable(makeMembershipsFake(), { ...ROOM, visibility: "private" }, OWNER),
    ).resolves.not.toThrow();
  });
});

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
  /** Eligible responders; defaults to all characters. */
  respondingCharacters?: Character[];
  /** Defaults to an ordinary room owned by `USER_AUTHOR_ID`. */
  room?: Room;
  generate?: (request: GenerateRequest) => Promise<GeneratedPost>;
  maxConcurrentCharacters?: number;
  maxCascadeDepth?: number;
  /** Defaults to pushing onto `tokenUsageRecords`; override to simulate a recording failure. */
  recordTokenUsage?: (userId: string, usage: NonNullable<GeneratedPost["usage"]>) => Promise<void>;
  /** Defaults to resolving `characters`; override to make the run fail before any post is generated. */
  findAllCharacters?: () => Promise<Character[]>;
};

type TokenUsageRecord = { userId: string; usage: NonNullable<GeneratedPost["usage"]> };

type Harness = {
  service: RoomRuntimeService;
  events: EventHub;
  posts: Post[];
  generationCalls: GenerateRequest[];
  threadSnapshots: Array<{ targetId: string; postIds: string[] }>;
  tokenUsageRecords: TokenUsageRecord[];
  /** Ids of the posts the thread payload was assembled for, in order. */
  threadActivityCalls: string[];
  membershipRepository: RoomMembershipRepository;
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

  const room = options.room ?? ROOM;

  const roomRepository = {
    create: (): Promise<Room> => Promise.resolve(room),
    findById: (id: string): Promise<Room | null> =>
      Promise.resolve(id === room.id ? room : null),
    updateStatus: (_id: string, status: Room["status"]): Promise<Room> =>
      Promise.resolve({ ...room, status }),
    updateTitle: (_id: string, title: string): Promise<Room> =>
      Promise.resolve({ ...room, title }),
  } as unknown as RoomRepository;

  const characterRepository = {
    findAll: (): Promise<Character[]> =>
      options.findAllCharacters ? options.findAllCharacters() : Promise.resolve(options.characters),
  } as unknown as CharacterRepository;

  // No memberships exist initially. Public-room posts create one as part of
  // the first-post auto-join flow.
  const membershipRepository = {
    findOne: vi.fn(() => Promise.resolve(null)),
    create: vi.fn((input: CreateMembershipInput) =>
      Promise.resolve({
        id: "membership-1",
        ...input,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      }),
    ),
  } as unknown as RoomMembershipRepository;

  const authorById = new Map(options.characters.map((character) => [character.id, character]));

  const toDto = (post: Post): PostDto => {
    const character = authorById.get(post.authorId);
    return {
      id: post.id,
      roomId: post.roomId,
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
        roomId: input.roomId,
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
    listByRoom(roomId: string): Promise<PostDto[]> {
      return Promise.resolve(
        posts.filter((post) => post.roomId === roomId).map(toDto),
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

  const logger: RoomRuntimeLogger = {
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

  /**
   * Stands in for the feed, which assembles the thread a post event carries
   * (§11.3). Only the identity of the thread matters here; the DTO's contents are
   * fixed in `feed-service.test.ts`.
   */
  const threadActivityCalls: string[] = [];
  const threadActivity = {
    buildThreadActivity: (post: Post): Promise<ThreadActivityEvent> => {
      threadActivityCalls.push(post.id);
      return Promise.resolve({
        type: "thread.activity",
        roomId: post.roomId,
        postId: post.id,
        room: {
          id: room.id,
          title: room.title,
          status: room.status,
          visibility: room.visibility,
        },
        thread: {
          root: toDto(posts.find((entry) => entry.id === post.threadRootId) ?? post),
          room: { id: room.id, title: room.title ?? "" },
          latestReplies: [],
          replyCount: 0,
          lastActivityAt: post.threadActivityAt.toISOString(),
          capabilities: {
            canOpenAuthor: false,
            canOpenRoom: false,
            canOpenThread: false,
            canReply: false,
            canQuote: false,
            canLoadMoreReplies: false,
          },
        },
      });
    },
  };

  // The cast resolver returns all characters for the test room. Tests use
  // explicit responder IDs so the resolver's output is the full candidate pool
  // from which explicit IDs are looked up.
  const castResolver = {
    resolveRespondingCasts: (): Promise<Character[]> =>
      Promise.resolve(options.respondingCharacters ?? options.characters),
  } as unknown as import("./cast-participation-resolver.js").CastParticipationResolver;

  const events = new EventHub();
  const service = new RoomRuntimeService({
    rooms: roomRepository,
    memberships: membershipRepository,
    posts: postService,
    characters: characterRepository,
    threads: threadService,
    agents: agentService,
    events,
    options: {
      // Tests choose responders explicitly. No opportunistic initial responders.
      minResponders: 0,
      maxResponders: 0,
      maxConcurrentCharacters: options.maxConcurrentCharacters ?? 1,
      maxCascadeDepth: options.maxCascadeDepth ?? 0,
    },
    logger,
    tokenUsage,
    threadActivity,
    castResolver,
  });

  return {
    service,
    events,
    posts,
    generationCalls,
    threadSnapshots,
    tokenUsageRecords,
    threadActivityCalls,
    membershipRepository,
  };
}

function knownMentions(content: string, characters: Character[]): string[] {
  const known = new Set(characters.map((character) => character.handle.toLowerCase()));
  return [...content.matchAll(/@([A-Za-z0-9_]{1,32})/gu)]
    .map((match) => (match[1] ?? "").toLowerCase())
    .filter((handle, index, all) => known.has(handle) && all.indexOf(handle) === index);
}

type CompletedEvent = Extract<InternalSseEvent, { type: "generation.completed" }>;

/**
 * Collects what the hub carried, and resolves when the run reports itself done.
 *
 * `generation.completed` is internal (§11.4): it never reaches a subscriber — the
 * public conversion drops it — but it is the signal a test can wait on, since
 * `submitUserPost` returns before generation starts.
 */
function collectUntilCompleted(events: EventHub): {
  received: InternalSseEvent[];
  completed: Promise<CompletedEvent>;
} {
  const received: InternalSseEvent[] = [];
  let resolveCompleted: ((event: CompletedEvent) => void) | undefined;
  const completed = new Promise<CompletedEvent>((resolve) => {
    resolveCompleted = resolve;
  });

  events.subscribe(ROOM.id, (event) => {
    received.push(event);
    if (event.type === "generation.completed") resolveCompleted?.(event);
  }, () => undefined);

  return { received, completed };
}

type TerminalEvent = Extract<
  InternalSseEvent,
  { type: "generation.completed" | "generation.failed" }
>;

/**
 * Like `collectUntilCompleted`, but resolves on whichever terminal event the run
 * actually publishes — a failed run never publishes `generation.completed`.
 */
function collectUntilTerminal(events: EventHub): {
  received: InternalSseEvent[];
  terminal: Promise<TerminalEvent>;
} {
  const received: InternalSseEvent[] = [];
  let resolveTerminal: ((event: TerminalEvent) => void) | undefined;
  const terminal = new Promise<TerminalEvent>((resolve) => {
    resolveTerminal = resolve;
  });

  events.subscribe(ROOM.id, (event) => {
    received.push(event);
    if (event.type === "generation.completed" || event.type === "generation.failed") {
      resolveTerminal?.(event);
    }
  }, () => undefined);

  return { received, terminal };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RoomRuntimeService.submitUserPost — room authorization (issue #175)", () => {
  it("rejects a non-member posting to a closed room", async () => {
    const harness = makeHarness({
      characters: [],
      room: { ...ROOM, visibility: "closed", createdByUserId: "someone-else" },
    });

    await expect(
      harness.service.submitUserPost({
        roomId: ROOM.id,
        authorId: USER_AUTHOR_ID,
        content: "投稿できないはず",
        responderIds: [],
      }),
    ).rejects.toThrow();
  });

  it("posts to the Feed room without querying membership (review: MR !104)", async () => {
    const harness = makeHarness({
      characters: [],
      room: { ...ROOM, scope: "global", createdByUserId: undefined },
    });

    const post = await harness.service.submitUserPost({
      roomId: ROOM.id,
      authorId: USER_AUTHOR_ID,
      content: "フィードへの投稿",
      responderIds: [],
    });

    expect(post.content).toBe("フィードへの投稿");
    expect(harness.membershipRepository.findOne).not.toHaveBeenCalled();
  });

  it("ignores only a unique-constraint race while auto-joining a public room", async () => {
    const harness = makeHarness({ characters: [] });
    vi.mocked(harness.membershipRepository.create).mockRejectedValueOnce(
      Object.assign(new Error("already created"), { code: "P2002" }),
    );

    await expect(
      harness.service.submitUserPost({
        roomId: ROOM.id,
        authorId: USER_AUTHOR_ID,
        content: "同時投稿",
        responderIds: [],
      }),
    ).resolves.toMatchObject({ content: "同時投稿" });
  });

  it("does not publish when public-room auto-join fails for another database reason", async () => {
    const harness = makeHarness({ characters: [] });
    const databaseError = new Error("database unavailable");
    vi.mocked(harness.membershipRepository.create).mockRejectedValueOnce(databaseError);

    await expect(
      harness.service.submitUserPost({
        roomId: ROOM.id,
        authorId: USER_AUTHOR_ID,
        content: "保存されない投稿",
        responderIds: [],
      }),
    ).rejects.toBe(databaseError);
    expect(harness.posts).toEqual([]);
  });
});

describe("RoomRuntimeService.requireReadableRoom vs requireReadableRoomForPosts (Feed room)", () => {
  /**
   * `computeRoomCapabilities` reports `canView: false` unconditionally for the
   * reserved Feed room (scope: 'global') — by design, so it never gets a
   * second room-shaped surface through `GET /api/rooms/:id` (room-authorization.ts).
   * `requireReadableRoomForPosts` exists specifically to bypass that for
   * reconstructing a post's own thread (§10.8), which must work the same
   * regardless of which room the post lives in. A feed-composed post's detail
   * view previously 404'd (`room "..." not found`) because its route called
   * the wrong one of these two methods.
   */
  it("requireReadableRoom still refuses the Feed room", async () => {
    const harness = makeHarness({
      characters: [],
      room: { ...ROOM, scope: "global", createdByUserId: undefined },
    });

    await expect(
      harness.service.requireReadableRoom(ROOM.id, { id: "any-user", isAdmin: false }),
    ).rejects.toThrow(RoomNotFoundError);
  });

  it("requireReadableRoomForPosts admits the Feed room so a feed post's thread can be read, and reports canPost", async () => {
    const harness = makeHarness({
      characters: [],
      room: { ...ROOM, scope: "global", createdByUserId: undefined },
    });

    await expect(
      harness.service.requireReadableRoomForPosts(ROOM.id, { id: "any-user", isAdmin: false }),
    ).resolves.toMatchObject({ room: { id: ROOM.id, scope: "global" }, canPost: true });
  });

  it("requireReadableRoomForPosts still enforces membership for an ordinary closed room", async () => {
    const harness = makeHarness({
      characters: [],
      room: { ...ROOM, visibility: "closed", createdByUserId: "someone-else" },
    });

    await expect(
      harness.service.requireReadableRoomForPosts(ROOM.id, { id: "non-member", isAdmin: false }),
    ).rejects.toThrow(RoomNotFoundError);
  });

  it("requireReadableRoomForPosts reports canPost: false for an archived room (§19.3)", async () => {
    const harness = makeHarness({
      characters: [],
      room: { ...ROOM, status: "archived" },
    });

    await expect(
      harness.service.requireReadableRoomForPosts(ROOM.id, OWNER),
    ).resolves.toMatchObject({ canPost: false });
  });
});

describe("RoomRuntimeService orchestration", () => {
  it("uses the full character list to resolve handles for previous Cast authors", async () => {
    const active = makeCharacter("active");
    const departed = makeCharacter("departed", { handle: "former_cast" });
    const harness = makeHarness({
      characters: [active, departed],
      respondingCharacters: [active],
    });
    harness.posts.push({
      id: "departed-post",
      roomId: ROOM.id,
      authorId: departed.id,
      content: "以前の投稿",
      mentions: [],
      replyTo: null,
      quoteOf: null,
      threadRootId: "departed-post",
      threadActivityAt: new Date("2025-12-31T23:59:00Z"),
      createdAt: new Date("2025-12-31T23:59:00Z"),
    });
    const stream = collectUntilCompleted(harness.events);

    await harness.service.submitUserPost({
      roomId: ROOM.id,
      authorId: USER_AUTHOR_ID,
      content: "hello",
      responderIds: [active.id],
    });
    await stream.completed;

    expect(harness.generationCalls[0]?.resolveHandle(departed.id)).toBe("former_cast");
  });

  it("persists and streams the user post before generating the character response", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const alpha = makeCharacter("alpha");
    const harness = makeHarness({ characters: [alpha] });
    const stream = collectUntilCompleted(harness.events);

    const userPost = await harness.service.submitUserPost({
      roomId: ROOM.id,
      authorId: USER_AUTHOR_ID,
      content: "hello",
      responderIds: [alpha.id],
    });
    const completed = await stream.completed;

    expect(harness.posts.map((post) => post.authorId)).toEqual([USER_AUTHOR_ID, alpha.id]);
    expect(harness.generationCalls).toHaveLength(1);
    expect(harness.generationCalls[0]?.target.id).toBe(userPost.id);
    expect(stream.received.map((event) => event.type)).toEqual([
      "thread.activity",
      "response.started",
      "thread.activity",
      "response.finished",
      "generation.completed",
    ]);
    // The activity says a response is being generated and against what — never by
    // whom (§11.2).
    expect(stream.received).toContainEqual(
      expect.objectContaining({
        type: "response.started",
        targetPostId: userPost.id,
        threadRootId: userPost.id,
      }),
    );
    expect(stream.received).toContainEqual(
      expect.objectContaining({ type: "response.finished", outcome: "posted" }),
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
      roomId: ROOM.id,
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
      roomId: ROOM.id,
      authorId: USER_AUTHOR_ID,
      content: "hello",
      responderIds: [broken.id, healthy.id],
    });
    await stream.completed;

    expect(harness.posts.map((post) => post.authorId)).toEqual([
      USER_AUTHOR_ID,
      healthy.id,
    ]);
    // The failure is reported as an outcome, without naming the character or the
    // provider that failed (§11.2). The reason stays in the log.
    expect(stream.received).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "response.finished", outcome: "failed" }),
        expect.objectContaining({ type: "response.finished", outcome: "posted" }),
        expect.objectContaining({ type: "generation.completed" }),
      ]),
    );
    expect(JSON.stringify(stream.received)).not.toContain("provider unavailable");
    // A partial failure is still a successful run: exactly one terminal event,
    // and it is the completed one.
    expect(stream.received.filter((event) => event.type === "generation.completed")).toHaveLength(
      1,
    );
    expect(stream.received.some((event) => event.type === "generation.failed")).toBe(false);
  });

  it("publishes exactly one generation.failed when the run fails before any post is generated", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const alpha = makeCharacter("alpha");
    const harness = makeHarness({
      characters: [alpha],
      findAllCharacters: () => Promise.reject(new Error("characters query failed")),
    });
    const stream = collectUntilTerminal(harness.events);

    await harness.service.submitUserPost({
      roomId: ROOM.id,
      authorId: USER_AUTHOR_ID,
      content: "hello",
      responderIds: [alpha.id],
    });
    const terminal = await stream.terminal;

    expect(terminal.type).toBe("generation.failed");
    expect(stream.received.filter((event) => event.type === "generation.completed")).toHaveLength(
      0,
    );
    expect(stream.received.filter((event) => event.type === "generation.failed")).toHaveLength(1);
    // The user's own post is unaffected by the character-generation failure.
    expect(harness.posts.map((post) => post.authorId)).toEqual([USER_AUTHOR_ID]);
    expect(harness.threadActivityCalls).toEqual(["post-1"]);
    // The reason is carried internally but never reaches a subscriber (§11.2) —
    // asserted at the public-conversion boundary in public-events.test.ts.
    expect(terminal).toMatchObject({ reason: "characters query failed" });
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
      roomId: ROOM.id,
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
      expect.objectContaining({ type: "response.started", targetPostId: "post-2" }),
    );
    expect(completed.generatedPostIds).toEqual(["post-2", "post-3"]);
  });

  it("accepts new posts again after a stopped room is resumed", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const alpha = makeCharacter("alpha");
    const harness = makeHarness({ characters: [alpha] });

    const stopped = await harness.service.stop(ROOM.id, OWNER);
    expect(stopped.status).toBe("archived");

    const resumed = await harness.service.resume(ROOM.id, OWNER);
    expect(resumed.status).toBe("active");

    const stream = collectUntilCompleted(harness.events);
    await harness.service.submitUserPost({
      roomId: ROOM.id,
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

describe("RoomRuntimeService cross-room post validation", () => {
  it("rejects a replyTo id that belongs to a different room", async () => {
    const harness = makeHarness({ characters: [] });
    const foreignPost: Post = {
      id: "post-in-another-room",
      roomId: "sim-other",
      authorId: USER_AUTHOR_ID,
      content: "from a different room",
      mentions: [],
      replyTo: null,
      quoteOf: null,
      threadRootId: "post-in-another-room",
      threadActivityAt: new Date("2026-01-01T00:00:00Z"),
      createdAt: new Date("2026-01-01T00:00:00Z"),
    };
    harness.posts.push(foreignPost);

    await expect(
      harness.service.submitUserPost({
        roomId: ROOM.id,
        authorId: USER_AUTHOR_ID,
        content: "hello",
        responderIds: [],
        replyTo: foreignPost.id,
      }),
    ).rejects.toBeInstanceOf(PostNotFoundError);

    // Nothing was published: the check runs before the post is persisted.
    expect(harness.posts).toEqual([foreignPost]);
  });

  it("rejects a quoteOf id that belongs to a different room", async () => {
    const harness = makeHarness({ characters: [] });
    const foreignPost: Post = {
      id: "post-in-another-room",
      roomId: "sim-other",
      authorId: USER_AUTHOR_ID,
      content: "from a different room",
      mentions: [],
      replyTo: null,
      quoteOf: null,
      threadRootId: "post-in-another-room",
      threadActivityAt: new Date("2026-01-01T00:00:00Z"),
      createdAt: new Date("2026-01-01T00:00:00Z"),
    };
    harness.posts.push(foreignPost);

    await expect(
      harness.service.submitUserPost({
        roomId: ROOM.id,
        authorId: USER_AUTHOR_ID,
        content: "hello",
        responderIds: [],
        quoteOf: foreignPost.id,
      }),
    ).rejects.toBeInstanceOf(PostNotFoundError);
  });
});

/**
 * The thread payload costs queries beyond the post, and one submission can
 * cascade into many posts, so it is only assembled when a stream is open to
 * receive it. `publish` would discard it otherwise.
 *
 * These cases use no characters on purpose: with generation out of the picture,
 * the only payload in play is the user post's, and `submitUserPost` awaits that
 * decision before returning — so there is nothing to wait on afterwards.
 */
describe("RoomRuntimeService thread events (§11.3)", () => {
  const onlyUserPost = {
    roomId: ROOM.id,
    authorId: USER_AUTHOR_ID,
    content: "hello",
    responderIds: [],
  };

  it("skips assembling the thread when neither stream is open", async () => {
    const harness = makeHarness({ characters: [] });

    await harness.service.submitUserPost(onlyUserPost);

    expect(harness.threadActivityCalls).toEqual([]);
    // The post itself is unaffected: only the event payload was skipped.
    expect(harness.posts).toHaveLength(1);
  });

  it("assembles the thread for a room subscriber", async () => {
    const harness = makeHarness({ characters: [] });
    harness.events.subscribe(ROOM.id, vi.fn(), () => undefined);

    const post = await harness.service.submitUserPost(onlyUserPost);

    expect(harness.threadActivityCalls).toEqual([post.id]);
  });

  /** The feed spans every room, so its listeners alone are reason enough to build. */
  it("assembles the thread for a feed subscriber with no room stream open", async () => {
    const harness = makeHarness({ characters: [] });
    const feed = vi.fn();
    harness.events.subscribeAll(feed);

    const post = await harness.service.submitUserPost(onlyUserPost);

    expect(harness.threadActivityCalls).toEqual([post.id]);
    expect(feed).toHaveBeenCalledWith(
      expect.objectContaining({ type: "thread.activity" }),
    );
  });
});

describe("RoomRuntimeService ownership (CLAUDE.md §66.6)", () => {
  const ADMIN: SignedInActor = { id: "admin-1", isAdmin: true };
  const OTHER_USER: SignedInActor = { id: "someone-else", isAdmin: false };

  it("lets the creator stop, resume and rename their own room", async () => {
    const harness = makeHarness({ characters: [makeCharacter("alpha")] });

    await expect(harness.service.stop(ROOM.id, OWNER)).resolves.toMatchObject({
      status: "archived",
    });
    await expect(harness.service.resume(ROOM.id, OWNER)).resolves.toMatchObject({
      status: "active",
    });
    await expect(
      harness.service.rename(ROOM.id, "new title", OWNER),
    ).resolves.toMatchObject({ title: "new title" });
  });

  it("lets an admin manage a room created by someone else", async () => {
    const harness = makeHarness({ characters: [makeCharacter("alpha")] });

    await expect(harness.service.stop(ROOM.id, ADMIN)).resolves.toMatchObject({
      status: "archived",
    });
  });

  it("rejects a signed-in caller who did not create the room", async () => {
    const harness = makeHarness({ characters: [makeCharacter("alpha")] });

    await expect(harness.service.stop(ROOM.id, OTHER_USER)).rejects.toBeInstanceOf(
      RoomManageForbiddenError,
    );
    await expect(harness.service.resume(ROOM.id, OTHER_USER)).rejects.toBeInstanceOf(
      RoomManageForbiddenError,
    );
    await expect(
      harness.service.rename(ROOM.id, "new title", OTHER_USER),
    ).rejects.toBeInstanceOf(RoomManageForbiddenError);
  });
});



describe("RoomRuntimeService token usage (CLAUDE.md §66.4)", () => {
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
      roomId: ROOM.id,
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
      roomId: ROOM.id,
      authorId: USER_AUTHOR_ID,
      content: "hello",
      responderIds: [alpha.id],
    });
    await stream.completed;

    expect(harness.tokenUsageRecords).toEqual([]);
  });

  it("does not turn a successful response into a failed outcome when recording usage throws", async () => {
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
      roomId: ROOM.id,
      authorId: USER_AUTHOR_ID,
      content: "hello",
      responderIds: [alpha.id],
    });
    const completed = await stream.completed;

    expect(harness.posts.map((post) => post.authorId)).toEqual([USER_AUTHOR_ID, alpha.id]);
    expect(completed.generatedPostIds).toEqual(["post-2"]);
    expect(
      stream.received.filter(
        (event) => event.type === "response.finished" && event.outcome === "failed",
      ),
    ).toEqual([]);
  });
});
