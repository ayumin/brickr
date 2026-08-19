import { randomUUID } from "node:crypto";
import {
  DEFAULT_ROOM_ID,
  type ResponseOutcome,
  type RoomDto,
  type RoomListEntryDto,
  type RoomResponse,
  type RoomSummaryDto,
} from "@brickr/shared";
import type { AgentService, GeneratedPost } from "../agents/agent-service.js";
import type { CharacterRepository } from "../characters/character-repository.js";
import type { Character } from "../characters/character.js";
import { DomainError } from "../domain-error.js";
import type { TokenUsageService } from "../llm/token-usage-service.js";
import type { LLMBudgetService } from "../llm/llm-budget-service.js";
import type { ProviderId } from "../llm/provider.js";
import { isUniqueConstraintError } from "../persistence/prisma.js";
import { optionalField } from "../persistence/repository-mapping.js";
import type { Post } from "../posts/post.js";
import type { PostService } from "../posts/post-service.js";
import type { ThreadContext, ThreadService } from "../posts/thread-service.js";
import { resolveActionTargets, selectAction } from "./action-selector.js";
import { runWithConcurrency } from "../lib/concurrency.js";
import type { EventHub } from "./event-hub.js";
import type { ThreadActivityEvent } from "./public-events.js";
import { computeRoomCapabilities, type RoomActor } from "./room-authorization.js";
import { selectCascadeResponders, selectResponders } from "./responder-selector.js";
import type { UserProfile } from "../user-profile/user-profile.js";
import type { RoomRepository } from "./room-repository.js";
import type { RoomMembershipRepository } from "./room-membership-repository.js";
import {
  type Room,
  type SignedInActor,
  type RoomSummary,
} from "./room.js";
import { CastParticipationResolver } from "./cast-participation-resolver.js";

/** Hard ceiling on character posts generated from one user post. */
const MAX_POSTS_PER_SUBMISSION = 24;

export type SubmitUserPostInput = {
  roomId: string;
  /** Account id of the signed-in author. Required: posting needs a session (#34). */
  authorId: string;
  /** Whether the author is an administrator (bypasses room membership checks). Defaults to false. */
  isAdmin?: boolean;
  content: string;
  imageUrl?: string;
  responderIds: string[];
  replyTo?: string | null;
  quoteOf?: string | null;
};

export type RoomRuntimeLogger = {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
};

export type RoomRuntimeServiceOptions = {
  minResponders: number;
  maxResponders: number;
  maxConcurrentCharacters: number;
  maxCascadeDepth: number;
};

/**
 * Builds the thread payload a post event carries (§11.3).
 *
 * Declared here as the narrow port this service needs, and satisfied by
 * `FeedService`, so the dependency stays one-way: the feed knows about
 * rooms, not the other way round.
 */
export type ThreadActivitySource = {
  buildThreadActivity: (post: Post) => Promise<ThreadActivityEvent>;
};

export type RoomRuntimeServiceDeps = {
  rooms: RoomRepository;
  memberships: RoomMembershipRepository;
  posts: PostService;
  characters: CharacterRepository;
  threads: ThreadService;
  agents: AgentService;
  events: EventHub;
  options: RoomRuntimeServiceOptions;
  logger: RoomRuntimeLogger;
  tokenUsage: TokenUsageService;
  threadActivity: ThreadActivitySource;
  /** Optional: when present, token usage is recorded against the provider budget (issue #162). */
  llmBudget?: LLMBudgetService;
  /** Resolves which Cast characters are eligible to respond in a given room (issue #177). */
  castResolver: CastParticipationResolver;
};

export class RuntimeRoomNotFoundError extends DomainError {
  readonly httpStatus = 404;
  readonly errorCode = "not_found" as const;
  constructor(id: string) {
    super(`room "${id}" not found`);
  }
}

export class RoomStoppedError extends DomainError {
  readonly httpStatus = 409;
  readonly errorCode = "room_archived" as const;
  constructor(id: string) {
    super(`room "${id}" has been stopped`);
  }
}

/** Rename/stop/resume/analysis are limited to the creator or an admin (CLAUDE.md §66.6). */
export class RoomManageForbiddenError extends DomainError {
  readonly httpStatus = 403;
  readonly errorCode = "forbidden" as const;
  constructor(id: string) {
    super(`not allowed to manage room "${id}"`);
  }
}

export class PostNotFoundError extends DomainError {
  readonly httpStatus = 404;
  readonly errorCode = "not_found" as const;
  constructor(id: string) {
    super(`post "${id}" not found`);
  }
}

/** A non-member (or banned actor) may not post into this room's visibility (issue #175). */
export class RoomPostForbiddenError extends DomainError {
  readonly httpStatus = 403;
  readonly errorCode = "forbidden" as const;
  constructor(id: string) {
    super(`not allowed to post in room "${id}"`);
  }
}

/**
 * Whether this actor may read one room (§10.2, §10.4).
 *
 * Both refusals are 404 rather than 403 on purpose: 403 confirms that something
 * is there, which turns any of these endpoints into a way to discover somebody
 * else's stopped rooms by id (§10.4).
 *
 * - A stopped room stays readable for its creator and for an administrator, and
 *   does not exist for anyone else. Note that this is about reading a room; the
 *   posts themselves remain visible to everybody through the unified feed, which
 *   is deliberately the only place they show up (§10.1).
 * - Closed/private rooms are readable only by their active members (or the
 *   owner/an admin), backed by a real `RoomMembership` lookup (issue #175,
 *   closing out the gap #153 deferred).
 *
 * Shared by the room feed, the room detail and the room's post list, so a caller
 * cannot reach through one endpoint what another would refuse.
 */
export async function assertRoomReadable(
  memberships: RoomMembershipRepository,
  room: Pick<Room, "id" | "status" | "visibility" | "createdByUserId" | "scope">,
  actor: SignedInActor,
): Promise<void> {
  const roomActor = await toRoomActor(memberships, room.id, actor, room.createdByUserId);
  const caps = computeRoomCapabilities(
    { visibility: room.visibility, status: room.status, scope: room.scope },
    roomActor,
  );

  if (!caps.canView) {
    throw new RuntimeRoomNotFoundError(room.id);
  }
}

/**
 * Orchestrates the reactions to one post.
 *
 * There is no round or wave model (CLAUDE.md §31): every character reads the
 * thread as it exists the moment that character starts working, so characters
 * that start later legitimately see more.
 */
export class RoomRuntimeService {
  /** Tracks in-flight generation per room so `stop` can take effect. */
  private readonly stopped = new Set<string>();

  constructor(private readonly deps: RoomRuntimeServiceDeps) {}

  async create(title: string | null, createdByUserId: string): Promise<RoomDto> {
    const room = await this.deps.rooms.create(title, createdByUserId);
    this.stopped.delete(room.id);
    return toRoomDto(room);
  }

  /**
   * Rooms visible to `actor`, minus the hidden Feed room.
   *
   * `DEFAULT_ROOM_ID` exists only as the unified feed's post target - it is a
   * real Room for persistence and feed aggregation, but never a listing a
   * caller should see or manage. Shared by `list()` and `listRooms()` so this
   * exclusion is defined once rather than duplicated at each call site.
   */
  private async listableRooms(actor: SignedInActor): Promise<RoomSummary[]> {
    const rooms = await this.deps.rooms.findAllVisibleTo(actor);
    return rooms.filter((room) => room.id !== DEFAULT_ROOM_ID);
  }

  /**
   * The room list for one caller (§10.3).
   *
   * `canManage` is computed here rather than left to the client: the same rule
   * decides whether `rename`/`stop`/`resume` will be accepted, so deriving it
   * twice is how a button appears for an action the server then refuses.
   */
  async list(actor: SignedInActor): Promise<RoomSummaryDto[]> {
    const rooms = await this.listableRooms(actor);
    return rooms.map((room) => toRoomSummaryDto(room, actor));
  }

  /**
   * The visibility-aware room list for one caller (issue #155).
   *
   * Extends `list()` with:
   * - Visibility enforcement: public/open/closed are discoverable; private
   *   requires active membership.
   * - Metadata restriction: closed rooms where the caller is not an active
   *   member return only id, title, visibility (no creator, postCount, etc.).
   * - Pending badge: owners receive a `pendingCount` field with the number of
   *   pending join requests.
   */
  async listRooms(actor: SignedInActor): Promise<RoomListEntryDto[]> {
    const rooms = await this.listableRooms(actor);
    return rooms.map((room) => toRoomListEntryDto(room, actor));
  }

  /**
   * One room's basics (§10.4, §19.2). The posts it used to carry are the
   * feed's job now; `postCount`/`creator`/`canManage` are here (rather than
   * on the leaner `requireReadableRoom` path below) because the room info
   * panel is this method's only reason to exist as a summary.
   *
   * Also includes server-computed `capabilities` for the caller (issue #178).
   */
  async get(id: string, actor: SignedInActor): Promise<RoomResponse> {
    const room = await this.requireRoomSummary(id);
    const roomActor = await toRoomActor(
      this.deps.memberships,
      room.id,
      actor,
      room.createdByUserId,
    );
    const caps = computeRoomCapabilities(
      { visibility: room.visibility, status: room.status, scope: room.scope },
      roomActor,
    );
    if (!caps.canView) {
      throw new RuntimeRoomNotFoundError(room.id);
    }
    const summary = toRoomSummaryDto(room, actor);
    return {
      room: {
        ...summary,
        capabilities: {
          canView: caps.canView,
          canPost: caps.canPost,
          canJoin: caps.canJoin,
          canLeave: caps.canLeave,
          canInvite: caps.canInvite,
          canManage: caps.canManage,
        },
      },
    };
  }

  /**
   * The room behind a room-scoped request, or a 404 (§10.4).
   *
   * Public so every route that treats this room *as a room* — the room
   * detail, the room feed — applies exactly the same rule. Do not reach for
   * this to gate "give me this room's posts" in general:
   * `requireReadableRoomForPosts` below is that rule, and it deliberately does
   * not refuse the global row.
   */
  async requireReadableRoom(id: string, actor: SignedInActor): Promise<Room> {
    const room = await this.requireRoom(id);
    await assertRoomReadable(this.deps.memberships, room, actor);
    return room;
  }

  /**
   * The room behind a request for its posts in full (§10.8), or a 404.
   *
   * Deliberately weaker than `requireReadableRoom`: a stopped room still stays
   * hidden from anyone but its creator or an administrator, but the global feed
   * row is not refused here. `assertRoomReadable`'s "not a room" rule exists to
   * stop the global feed from getting a second, room-shaped surface through
   * `GET /api/rooms/:id` — it was never
   * about whether a post's own thread (post detail, §10.8) can be reconstructed,
   * which must work the same way regardless of which room a post lives in.
   *
   * Closed/private rooms require an active membership (or ownership/admin),
   * backed by a real `RoomMembership` lookup (issue #175, closing out #153) —
   * except the Feed room, which has no membership rows and is never refused.
   */
  async requireReadableRoomForPosts(id: string, actor: SignedInActor): Promise<Room> {
    const room = await this.requireRoom(id);
    // The Feed room is deliberately never refused here (see the doc comment
    // above): it has no membership rows, and computeRoomCapabilities's Feed-room
    // branch would otherwise report canView: false for everyone.
    if (room.scope === "global") return room;
    const roomActor = await toRoomActor(
      this.deps.memberships,
      room.id,
      actor,
      room.createdByUserId,
    );
    const caps = computeRoomCapabilities(
      { visibility: room.visibility, status: room.status, scope: room.scope },
      roomActor,
    );
    if (!caps.canView) {
      throw new RuntimeRoomNotFoundError(room.id);
    }
    return room;
  }

  private async requireRoomSummary(id: string): Promise<RoomSummary> {
    const room = await this.deps.rooms.findSummaryById(id);
    if (!room) throw new RuntimeRoomNotFoundError(id);
    return room;
  }

  async rename(id: string, title: string, actor: SignedInActor): Promise<RoomDto> {
    const room = await this.requireRoom(id);
    assertRoomOwnerOrAdmin(room, actor);
    return toRoomDto(await this.deps.rooms.updateTitle(id, title));
  }

  async stop(id: string, actor: SignedInActor): Promise<RoomDto> {
    const room = await this.requireRoom(id);
    assertRoomOwnerOrAdmin(room, actor);
    this.stopped.add(id);
    const stoppedRoom = await this.deps.rooms.updateStatus(id, "archived");
    return toRoomDto(stoppedRoom);
  }

  async resume(id: string, actor: SignedInActor): Promise<RoomDto> {
    const room = await this.requireRoom(id);
    assertRoomOwnerOrAdmin(room, actor);
    this.stopped.delete(id);
    const resumedRoom = await this.deps.rooms.updateStatus(id, "active");
    return toRoomDto(resumedRoom);
  }

  /**
   * Persists the user's post, publishes it immediately, and kicks off character
   * generation in the background. The caller does not wait for the characters.
   */
  async submitUserPost(input: SubmitUserPostInput): Promise<Post> {
    const room = await this.requireRoom(input.roomId);
    if (room.status === "archived") {
      throw new RoomStoppedError(input.roomId);
    }

    // The Feed room's canPost only checks isAuthenticated (no membership row
    // exists to look up), so skip the query entirely for it — the same
    // short-circuit `requireReadableRoom` above already uses.
    if (room.scope !== "global") {
      const roomActor = await toRoomActor(
        this.deps.memberships,
        input.roomId,
        { id: input.authorId, isAdmin: input.isAdmin ?? false },
        room.createdByUserId,
      );
      const caps = computeRoomCapabilities(
        { visibility: room.visibility, status: room.status, scope: room.scope },
        roomActor,
      );
      if (!caps.canPost) {
        throw new RoomPostForbiddenError(input.roomId);
      }
    }

    await this.assertPostBelongsToRoom(input.replyTo, input.roomId);
    await this.assertPostBelongsToRoom(input.quoteOf, input.roomId);

    // Auto-join: for public rooms, ensure the posting user has an active
    // membership before the post is saved (issue #176). This makes the first
    // post in a public room atomically create the membership so the user
    // appears in the member list immediately. left/removed actors are
    // re-activated; banned actors are already blocked by canPost above.
    if (room.scope !== "global" && room.visibility === "public") {
      await this.ensurePublicRoomMembership(input.roomId, input.authorId);
    }

    const post = await this.deps.posts.publish({
      roomId: input.roomId,
      authorId: input.authorId,
      content: input.content,
      ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
      replyTo: input.replyTo ?? null,
      quoteOf: input.quoteOf ?? null,
    });

    await this.emitPostCreated(post);

    // Fire and forget: the HTTP response returns now, posts stream over SSE.
    // `runGeneration` reports its own outcome and does not reject; this `.catch`
    // is a last resort so a failure in the reporting itself cannot become an
    // unhandled rejection.
    void this.runGeneration(post, input.responderIds, room.scope).catch(() => undefined);

    return post;
  }

  // -- generation -----------------------------------------------------------

  /** Publishes exactly one of `generation.completed` / `generation.failed` per run. */
  private async runGeneration(
    triggerPost: Post,
    explicitIds: string[],
    roomScope: Room["scope"],
  ): Promise<void> {
    const generatedIds: string[] = [];
    const budget = { remaining: MAX_POSTS_PER_SUBMISSION };

    try {
      // Resolve the eligible Cast for this room: all active Casts for the Feed
      // room, or only active-membership Casts for a regular room (issue #177).
      const eligibleCharacters = await this.deps.castResolver.resolveRespondingCasts({
        roomId: triggerPost.roomId,
        roomScope,
      });

      const { all: responders } = selectResponders({
        characters: eligibleCharacters,
        mentionedHandles: triggerPost.mentions,
        explicitIds,
        excludeIds: [triggerPost.authorId],
        minResponders: this.deps.options.minResponders,
        maxResponders: this.deps.options.maxResponders,
      });

      // Eligibility and transcript identity are separate concerns. Include
      // non-Cast/previous Cast authors so old posts still resolve their handles.
      const allCharacters = responders.length > 0
        ? await this.deps.characters.findAll()
        : [];

      await this.processTarget({
        target: triggerPost,
        responders,
        eligibleCharacters,
        allCharacters,
        depth: 0,
        generatedIds,
        budget,
        // Every generation this submission causes — including cascades several
        // characters deep — is billed to the human who started it (§66.4).
        billingUserId: triggerPost.authorId,
      });

      this.deps.events.publish(triggerPost.roomId, {
        type: "generation.completed",
        roomId: triggerPost.roomId,
        triggerPostId: triggerPost.id,
        generatedPostIds: generatedIds,
      });
    } catch (error) {
      this.deps.logger.error(
        { roomId: triggerPost.roomId, err: describe(error) },
        "room run failed",
      );
      // Internal only: the reason names the provider or model that failed, which
      // would say out loud that the author is an AI (§11.2). Subscribers learn
      // about failures through `response.finished` outcomes instead.
      this.deps.events.publish(triggerPost.roomId, {
        type: "generation.failed",
        roomId: triggerPost.roomId,
        reason: describe(error),
      });
    }
  }

  /** Runs one set of characters against one target post, then cascades. */
  private async processTarget(input: {
    target: Post;
    responders: Character[];
    eligibleCharacters: Character[];
    allCharacters: Character[];
    depth: number;
    generatedIds: string[];
    budget: { remaining: number };
    billingUserId: string;
  }): Promise<void> {
    const {
      target,
      responders,
      eligibleCharacters,
      allCharacters,
      depth,
      generatedIds,
      budget,
      billingUserId,
    } = input;
    if (responders.length === 0 || budget.remaining <= 0) return;

    const slice = responders.slice(0, budget.remaining);
    budget.remaining -= slice.length;

    const results = await runWithConcurrency(
      slice,
      this.deps.options.maxConcurrentCharacters,
      (character) => this.processCharacter(character, target, allCharacters, billingUserId),
    );

    for (const result of results) {
      if ("value" in result && result.value !== null) {
        generatedIds.push(result.value.id);
      }
    }

    if (depth >= this.deps.options.maxCascadeDepth) return;

    // Characters react to what the previous step produced. Done sequentially
    // per post but concurrently within each cascade step.
    const cascades: Array<Promise<void>> = [];

    for (const result of results) {
      if (!("value" in result) || result.value === null) continue;
      if (budget.remaining <= 0) break;

      const producedPost = result.value;
      const author = result.item;

      const followers = selectCascadeResponders({
        allCharacters: eligibleCharacters,
        producedPost,
        author,
        depth,
      });
      if (followers.length === 0) continue;

      cascades.push(
        this.processTarget({
          target: producedPost,
          responders: followers,
          eligibleCharacters,
          allCharacters,
          depth: depth + 1,
          generatedIds,
          budget,
          billingUserId,
        }),
      );
    }

    await Promise.all(cascades);
  }

  /**
   * One character's turn, from "did it stay quiet" to "the SSE activity is
   * closed" — the lifecycle boundary around `generateAndPublish`.
   *
   * Returns the post it produced, or null if it stayed quiet or failed.
   */
  private async processCharacter(
    character: Character,
    target: Post,
    allCharacters: Character[],
    billingUserId: string,
  ): Promise<Post | null> {
    const roomId = target.roomId;
    if (this.stopped.has(roomId)) return null;

    // The activity, not the character: subscribers learn that *a* response is
    // being generated, never whose (§11.2). The id exists only to pair the finish
    // with this start; everything worth investigating goes to the log below.
    const activity = this.beginResponse(target);
    let outcome: ResponseOutcome = "skipped";

    try {
      const post = await this.generateAndPublish(character, target, allCharacters, billingUserId);
      outcome = post ? "posted" : "skipped";
      return post;
    } catch (error) {
      outcome = "failed";
      // The only place the reason exists. Publishing it would describe the
      // machinery behind the post (§11.2).
      this.deps.logger.warn(
        { roomId, characterId: character.id, err: describe(error) },
        "character generation failed",
      );
      return null;
    } finally {
      // In a `finally` so every start is answered exactly once, including when
      // generation throws or the room was stopped mid-flight. An unanswered
      // start would leave the UI showing a response that never arrives.
      activity.finish(outcome);
    }
  }

  /**
   * Picks an action, generates, persists and publishes. Returns null if the
   * thread disappeared or the room was stopped mid-flight — both are
   * "stayed quiet", not a failure, so the caller must not treat them as one.
   */
  private async generateAndPublish(
    character: Character,
    target: Post,
    allCharacters: Character[],
    billingUserId: string,
  ): Promise<Post | null> {
    const roomId = target.roomId;

    const context = await this.loadGenerationContext(target, allCharacters);
    if (!context) return null;
    const { thread, resolveHandle } = context;

    const action = selectAction({
      character,
      target: thread.target,
      threadPosts: thread.posts,
    });

    const generated = await this.deps.agents.generate({
      character,
      target: thread.target,
      posts: thread.posts,
      action,
      resolveHandle,
    });

    if (this.stopped.has(roomId)) return null;

    if (generated.usage) {
      await this.recordUsage(billingUserId, generated.usage, {
        roomId,
        characterId: character.id,
        providerId: generated.providerId,
      });
    }

    const { replyTo, quoteOf } = resolveActionTargets(action, thread.target);

    const post = await this.deps.posts.publish({
      roomId: roomId,
      authorId: character.id,
      content: generated.content,
      replyTo,
      quoteOf,
    });

    this.deps.logger.info(
      {
        roomId,
        characterId: character.id,
        action,
        providerId: generated.providerId,
        model: generated.model,
      },
      "character posted",
    );

    await this.emitPostCreated(post);
    return post;
  }

  /**
   * Thread and handle context, read fresh immediately before the LLM call
   * (CLAUDE.md §32). Returns null when the target has disappeared from the
   * thread since this character's turn started.
   */
  private async loadGenerationContext(
    target: Post,
    allCharacters: Character[],
  ): Promise<{ thread: ThreadContext; resolveHandle: (authorId: string) => string } | null> {
    const thread = await this.deps.threads.getCurrentThread(target.id);
    if (!thread) return null;

    // The transcript names users by handle too, so a character can react to
    // the person who wrote the post rather than to an opaque id.
    const users = await this.deps.posts.findUsersByIds(
      [thread.target, ...thread.posts].map((post) => post.authorId),
    );
    const resolveHandle = buildHandleResolver(allCharacters, users);

    return { thread, resolveHandle };
  }

  /**
   * Recorded even if publishing fails below: the tokens were already spent. A
   * tracking hiccup is logged, not surfaced as a failed response — it must
   * never turn a successful generation into a failed outcome.
   */
  private async recordUsage(
    billingUserId: string,
    usage: NonNullable<GeneratedPost["usage"]>,
    context: { roomId: string; characterId: string; providerId: ProviderId },
  ): Promise<void> {
    try {
      await this.deps.tokenUsage.record(billingUserId, usage);
    } catch (error) {
      this.deps.logger.warn(
        { ...context, billingUserId, err: describe(error) },
        "failed to record token usage",
      );
    }

    // Record against the provider budget (issue #162). Failures are logged but
    // never surfaced — a tracking hiccup must not turn a successful generation
    // into a failed outcome.
    if (this.deps.llmBudget) {
      try {
        await this.deps.llmBudget.recordUsage(
          context.providerId,
          usage.totalTokens,
          context.roomId,
        );
      } catch (error) {
        this.deps.logger.warn(
          { ...context, err: describe(error) },
          "failed to record LLM budget usage",
        );
      }
    }
  }

  /**
   * Opens one anonymous response activity and hands back how to close it.
   *
   * `randomUUID` rather than anything derived from the character: an id that could
   * be traced back to a row would defeat the point of hiding it.
   */
  private beginResponse(target: Post): { finish: (outcome: ResponseOutcome) => void } {
    const activityId = randomUUID();
    const shared = {
      roomId: target.roomId,
      activityId,
      targetPostId: target.id,
      threadRootId: target.threadRootId,
    };

    this.deps.events.publish(target.roomId, { type: "response.started", ...shared });

    return {
      finish: (outcome) => {
        this.deps.events.publish(target.roomId, {
          type: "response.finished",
          ...shared,
          outcome,
        });
      },
    };
  }

  /**
   * Publishes the thread the post now belongs to, not the post on its own (§11.3).
   *
   * The same event reaches this room's subscribers and the unified feed's, so both
   * surfaces move at the same moment and describe the thread identically.
   */
  private async emitPostCreated(post: Post): Promise<void> {
    // Assembling the thread costs queries beyond the post itself, and one
    // submission can cascade into `MAX_POSTS_PER_SUBMISSION` of them. With no
    // stream open, `publish` would discard the payload, so skip building it.
    //
    // This does not reopen the race that subscribing before hydrating closes: a
    // stream that opens after this check hydrates over REST afterwards, and the
    // post is committed by then, so it cannot be missed.
    if (!this.deps.events.hasSubscribers(post.roomId)) return;

    this.deps.events.publish(
      post.roomId,
      await this.deps.threadActivity.buildThreadActivity(post),
    );
  }

  // -- helpers --------------------------------------------------------------

  private async requireRoom(id: string): Promise<Room> {
    const room = await this.deps.rooms.findById(id);
    if (!room) throw new RuntimeRoomNotFoundError(id);
    return room;
  }

  private async assertPostBelongsToRoom(
    postId: string | null | undefined,
    roomId: string,
  ): Promise<void> {
    if (!postId) return;
    const post = await this.deps.posts.findById(postId);
    if (!post || post.roomId !== roomId) {
      throw new PostNotFoundError(postId);
    }
  }

  /**
   * Ensures the posting user has an active membership in a public room (issue #176).
   *
   * Called before saving the post so the membership is visible immediately.
   * - No existing row: creates an active membership (first post = auto-join).
   * - left/removed: reactivates the membership (re-join on re-post).
   * - active/pending: no-op (already a member or pending approval).
   * - banned: already blocked by canPost above; this path is never reached.
   */
  private async ensurePublicRoomMembership(roomId: string, userId: string): Promise<void> {
    const existing = await this.deps.memberships.findOne(roomId, "user", userId);
    if (!existing) {
      // First post: create an active membership.
      try {
        await this.deps.memberships.create({
          roomId,
          memberKind: "user",
          memberId: userId,
          role: "member",
          status: "active",
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        // A concurrent post may have already created the membership; ignore
        // unique constraint violations and let the post proceed.
      }
    } else if (existing.status === "left" || existing.status === "removed") {
      // Re-post after leaving/being removed: reactivate.
      await this.deps.memberships.updateStatusByMember(roomId, "user", userId, "active");
    }
    // active / pending: already handled; banned: blocked upstream.
  }
}

export function toRoomDto(room: Room): RoomDto {
  return {
    id: room.id,
    title: room.title,
    status: room.status,
    visibility: room.visibility,
    createdAt: room.createdAt.toISOString(),
    ...optionalField("createdByUserId", room.createdByUserId),
  };
}

/**
 * Shared by `list()` and `get()` (§10.3, §19.2): `canManage` is computed here
 * rather than left to the client, since the same rule decides whether
 * `rename`/`stop`/`resume` will be accepted — deriving it twice is how a
 * button appears for an action the server then refuses.
 *
 * `pendingCount` is included only for the room owner (issue #155): it is the
 * number of pending join requests, used to show a badge on the room entry.
 * Non-owners receive no `pendingCount` field at all.
 */
export function toRoomSummaryDto(
  room: RoomSummary,
  actor: SignedInActor,
): RoomSummaryDto {
  const isOwner = isRoomOwnerOrAdmin(room, actor);
  return {
    ...toRoomDto(room),
    postCount: room.postCount,
    lastActivityAt: room.lastActivityAt.toISOString(),
    creator: room.creator,
    canManage: isOwner,
    ...(isOwner && room.pendingCount !== undefined
      ? { pendingCount: room.pendingCount }
      : {}),
  };
}

export type { SignedInActor } from "./room.js";

/**
 * Converts a `SignedInActor` to a `RoomActor` for the authorization service.
 *
 * Queries `RoomMembership` for the actor's real row in this room (issue #175)
 * and only falls back to synthesising an owner membership from
 * `createdByUserId` when no row exists — a legacy room created before
 * `RoomMembership` existed (issue #152). A current room's owner always has a
 * real row, granted in the same transaction as `RoomService.create`.
 *
 * A room with no owner (`createdByUserId` absent) matches no actor id, so only
 * an admin may manage it — mirrors the Character rule (§66.14).
 */
export async function toRoomActor(
  memberships: RoomMembershipRepository,
  roomId: string,
  actor: SignedInActor,
  createdByUserId: string | undefined | null,
): Promise<RoomActor> {
  const membership = await memberships.findOne(roomId, "user", actor.id);
  if (membership) {
    return {
      kind: "user",
      userId: actor.id,
      isAdmin: actor.isAdmin,
      membership: { memberKind: membership.memberKind, role: membership.role, status: membership.status },
    };
  }

  // No membership row: only reached for rooms created before RoomMembership
  // existed (issue #152) — `RoomService.create` grants the creator a real
  // owner membership in the same transaction, so a current room always has
  // one. Synthesise the ownership rule from `createdByUserId` so the original
  // creator (and only them) keeps read/manage access to their legacy room.
  const isOwner = createdByUserId != null && actor.id === createdByUserId;
  return {
    kind: "user",
    userId: actor.id,
    isAdmin: actor.isAdmin,
    membership: isOwner
      ? { memberKind: "user", role: "owner", status: "active" }
      : undefined,
  };
}

/**
 * A room with no owner (created before login existed) matches no actor
 * id, so only an admin may manage it — mirrors the Character rule (§66.14),
 * even though Room ownership itself is public rather than private.
 */
export function isRoomOwnerOrAdmin(
  room: Pick<Room, "createdByUserId">,
  actor: SignedInActor,
): boolean {
  return actor.isAdmin || actor.id === room.createdByUserId;
}

export function assertRoomOwnerOrAdmin(
  room: Room,
  actor: SignedInActor,
): void {
  if (!isRoomOwnerOrAdmin(room, actor)) {
    throw new RoomManageForbiddenError(room.id);
  }
}

/**
 * Converts a `RoomSummary` to a `RoomListEntryDto` for the visibility-
 * aware room list (issue #155).
 *
 * For `closed` rooms where the caller is not an active member, only the
 * prescribed metadata fields are returned (restricted entry). For all other
 * rooms, the full summary DTO is returned with `restricted: false`.
 *
 * The `callerIsActiveMember` flag is set by the repository query so this
 * function does not need a second DB round-trip.
 */
export function toRoomListEntryDto(
  room: RoomSummary,
  actor: SignedInActor,
): RoomListEntryDto {
  const isOwnerOrAdmin = isRoomOwnerOrAdmin(room, actor);
  const isActiveMember = room.callerIsActiveMember ?? false;

  // Closed rooms: non-members (who are not the owner or admin) receive only
  // the prescribed metadata. Owners and admins always get the full entry.
  if (
    room.visibility === "closed" &&
    !isActiveMember &&
    !isOwnerOrAdmin
  ) {
    return {
      restricted: true,
      id: room.id,
      title: room.title,
      visibility: room.visibility,
      createdAt: room.createdAt.toISOString(),
    };
  }

  return {
    restricted: false,
    isMember: isActiveMember,
    ...toRoomSummaryDto(room, actor),
  };
}

/**
 * Handles for the transcript. Users and characters resolve the same way, since
 * they share one namespace (§66.13); an id with no owner falls back to itself.
 */
function buildHandleResolver(
  characters: Character[],
  users: UserProfile[],
): (authorId: string) => string {
  const byId = new Map<string, string>([
    ...characters.map((character) => [character.id, character.handle] as const),
    ...users.map((user) => [user.id, user.handle] as const),
  ]);
  return (authorId: string) => byId.get(authorId) ?? authorId;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
