import { randomUUID } from "node:crypto";
import type {
  ResponseOutcome,
  SimulationDto,
  SimulationResponse,
  SimulationSummaryDto,
} from "@brickr/shared";
import type { AgentService, GeneratedPost } from "../agents/agent-service.js";
import type { UserAccount } from "../auth/user-account.js";
import type { CharacterRepository } from "../characters/character-repository.js";
import type { Character } from "../characters/character.js";
import { DomainError } from "../domain-error.js";
import type { TokenUsageService } from "../llm/token-usage-service.js";
import type { Post } from "../posts/post.js";
import type { PostService } from "../posts/post-service.js";
import type { ThreadContext, ThreadService } from "../posts/thread-service.js";
import { resolveActionTargets, selectAction } from "./action-selector.js";
import { runWithConcurrency } from "../lib/concurrency.js";
import type { EventHub } from "./event-hub.js";
import type { ThreadActivityEvent } from "./public-events.js";
import { selectCascadeResponders, selectResponders } from "./responder-selector.js";
import type { UserProfile } from "../user-profile/user-profile.js";
import type { SimulationRepository } from "./simulation-repository.js";
import { isGlobalSimulation, type Simulation } from "./simulation.js";

/** Hard ceiling on character posts generated from one user post. */
const MAX_POSTS_PER_SUBMISSION = 24;

export type SubmitUserPostInput = {
  simulationId: string;
  /** Account id of the signed-in author. Required: posting needs a session (#34). */
  authorId: string;
  content: string;
  imageUrl?: string;
  responderIds: string[];
  replyTo?: string | null;
  quoteOf?: string | null;
};

export type SimulationLogger = {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
};

export type SimulationServiceOptions = {
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
 * simulations, not the other way round.
 */
export type ThreadActivitySource = {
  buildThreadActivity: (post: Post) => Promise<ThreadActivityEvent>;
};

export type SimulationServiceDeps = {
  simulations: SimulationRepository;
  posts: PostService;
  characters: CharacterRepository;
  threads: ThreadService;
  agents: AgentService;
  events: EventHub;
  options: SimulationServiceOptions;
  logger: SimulationLogger;
  tokenUsage: TokenUsageService;
  threadActivity: ThreadActivitySource;
};

export class SimulationNotFoundError extends DomainError {
  readonly httpStatus = 404;
  readonly errorCode = "not_found" as const;
  constructor(id: string) {
    super(`simulation "${id}" not found`);
  }
}

export class SimulationStoppedError extends DomainError {
  readonly httpStatus = 409;
  readonly errorCode = "simulation_stopped" as const;
  constructor(id: string) {
    super(`simulation "${id}" has been stopped`);
  }
}

/** Rename/stop/resume/analysis are limited to the creator or an admin (CLAUDE.md §66.6). */
export class SimulationForbiddenError extends DomainError {
  readonly httpStatus = 403;
  readonly errorCode = "forbidden" as const;
  constructor(id: string) {
    super(`not allowed to manage simulation "${id}"`);
  }
}

export class PostNotFoundError extends DomainError {
  readonly httpStatus = 404;
  readonly errorCode = "not_found" as const;
  constructor(id: string) {
    super(`post "${id}" not found`);
  }
}

/**
 * The reserved global simulation is the feed itself (§8.2), so renaming,
 * stopping, resuming or analysing it would break every screen at once.
 *
 * Refused here rather than only in the UI, because a UI guard is bypassed by
 * calling the API directly.
 */
export class GlobalSimulationMutationError extends DomainError {
  readonly httpStatus = 403;
  readonly errorCode = "forbidden" as const;
  constructor(id: string) {
    super(`simulation "${id}" is the global feed and cannot be managed as a room`);
  }
}

export function assertNotGlobalSimulation(
  simulation: Pick<Simulation, "id" | "scope">,
): void {
  if (isGlobalSimulation(simulation)) {
    throw new GlobalSimulationMutationError(simulation.id);
  }
}

/**
 * Orchestrates the reactions to one post.
 *
 * There is no round or wave model (CLAUDE.md §31): every character reads the
 * thread as it exists the moment that character starts working, so characters
 * that start later legitimately see more.
 */
export class SimulationService {
  /** Tracks in-flight generation per simulation so `stop` can take effect. */
  private readonly stopped = new Set<string>();

  constructor(private readonly deps: SimulationServiceDeps) {}

  async create(title: string | null, createdByUserId: string): Promise<SimulationDto> {
    const simulation = await this.deps.simulations.create(title, createdByUserId);
    this.stopped.delete(simulation.id);
    return toSimulationDto(simulation);
  }

  async list(): Promise<SimulationSummaryDto[]> {
    const simulations = await this.deps.simulations.findAll();
    return simulations.map((simulation) => ({
      ...toSimulationDto(simulation),
      postCount: simulation.postCount,
    }));
  }

  async get(id: string): Promise<SimulationResponse> {
    const simulation = await this.requireSimulation(id);
    const posts = await this.deps.posts.listBySimulation(id);
    return { simulation: toSimulationDto(simulation), posts };
  }

  async rename(id: string, title: string, actor: SimulationActor): Promise<SimulationDto> {
    const simulation = await this.requireSimulation(id);
    // Before the ownership check: the global row has no creator, so an admin
    // would otherwise be allowed through (§8.2).
    assertNotGlobalSimulation(simulation);
    assertSimulationOwnerOrAdmin(simulation, actor);
    return toSimulationDto(await this.deps.simulations.updateTitle(id, title));
  }

  async stop(id: string, actor: SimulationActor): Promise<SimulationDto> {
    const simulation = await this.requireSimulation(id);
    assertNotGlobalSimulation(simulation);
    assertSimulationOwnerOrAdmin(simulation, actor);
    this.stopped.add(id);
    const stoppedSimulation = await this.deps.simulations.updateStatus(id, "stopped");
    return toSimulationDto(stoppedSimulation);
  }

  async resume(id: string, actor: SimulationActor): Promise<SimulationDto> {
    const simulation = await this.requireSimulation(id);
    assertNotGlobalSimulation(simulation);
    assertSimulationOwnerOrAdmin(simulation, actor);
    this.stopped.delete(id);
    const resumedSimulation = await this.deps.simulations.updateStatus(id, "active");
    return toSimulationDto(resumedSimulation);
  }

  /**
   * Persists the user's post, publishes it immediately, and kicks off character
   * generation in the background. The caller does not wait for the characters.
   */
  async submitUserPost(input: SubmitUserPostInput): Promise<Post> {
    const simulation = await this.requireSimulation(input.simulationId);
    if (simulation.status === "stopped") {
      throw new SimulationStoppedError(input.simulationId);
    }

    await this.assertPostBelongsToSimulation(input.replyTo, input.simulationId);
    await this.assertPostBelongsToSimulation(input.quoteOf, input.simulationId);

    const post = await this.deps.posts.publish({
      simulationId: input.simulationId,
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
    void this.runGeneration(post, input.responderIds).catch(() => undefined);

    return post;
  }

  // -- generation -----------------------------------------------------------

  /** Publishes exactly one of `generation.completed` / `generation.failed` per run. */
  private async runGeneration(triggerPost: Post, explicitIds: string[]): Promise<void> {
    const generatedIds: string[] = [];
    const budget = { remaining: MAX_POSTS_PER_SUBMISSION };

    try {
      const all = await this.deps.characters.findAll();

      const { all: responders } = selectResponders({
        characters: all,
        mentionedHandles: triggerPost.mentions,
        explicitIds,
        excludeIds: [triggerPost.authorId],
        minResponders: this.deps.options.minResponders,
        maxResponders: this.deps.options.maxResponders,
      });

      await this.processTarget({
        target: triggerPost,
        responders,
        allCharacters: all,
        depth: 0,
        generatedIds,
        budget,
        // Every generation this submission causes — including cascades several
        // characters deep — is billed to the human who started it (§66.4).
        billingUserId: triggerPost.authorId,
      });

      this.deps.events.publish(triggerPost.simulationId, {
        type: "generation.completed",
        simulationId: triggerPost.simulationId,
        triggerPostId: triggerPost.id,
        generatedPostIds: generatedIds,
      });
    } catch (error) {
      this.deps.logger.error(
        { simulationId: triggerPost.simulationId, err: describe(error) },
        "simulation run failed",
      );
      // Internal only: the reason names the provider or model that failed, which
      // would say out loud that the author is an AI (§11.2). Subscribers learn
      // about failures through `response.finished` outcomes instead.
      this.deps.events.publish(triggerPost.simulationId, {
        type: "generation.failed",
        simulationId: triggerPost.simulationId,
        reason: describe(error),
      });
    }
  }

  /** Runs one set of characters against one target post, then cascades. */
  private async processTarget(input: {
    target: Post;
    responders: Character[];
    allCharacters: Character[];
    depth: number;
    generatedIds: string[];
    budget: { remaining: number };
    billingUserId: string;
  }): Promise<void> {
    const { target, responders, allCharacters, depth, generatedIds, budget, billingUserId } =
      input;
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
        allCharacters,
        producedPost,
        author,
        depth,
      });
      if (followers.length === 0) continue;

      cascades.push(
        this.processTarget({
          target: producedPost,
          responders: followers,
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
    const simulationId = target.simulationId;
    if (this.stopped.has(simulationId)) return null;

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
        { simulationId, characterId: character.id, err: describe(error) },
        "character generation failed",
      );
      return null;
    } finally {
      // In a `finally` so every start is answered exactly once, including when
      // generation throws or the simulation was stopped mid-flight. An unanswered
      // start would leave the UI showing a response that never arrives.
      activity.finish(outcome);
    }
  }

  /**
   * Picks an action, generates, persists and publishes. Returns null if the
   * thread disappeared or the simulation was stopped mid-flight — both are
   * "stayed quiet", not a failure, so the caller must not treat them as one.
   */
  private async generateAndPublish(
    character: Character,
    target: Post,
    allCharacters: Character[],
    billingUserId: string,
  ): Promise<Post | null> {
    const simulationId = target.simulationId;

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

    if (this.stopped.has(simulationId)) return null;

    if (generated.usage) {
      await this.recordUsage(billingUserId, generated.usage, {
        simulationId,
        characterId: character.id,
      });
    }

    const { replyTo, quoteOf } = resolveActionTargets(action, thread.target);

    const post = await this.deps.posts.publish({
      simulationId,
      authorId: character.id,
      content: generated.content,
      replyTo,
      quoteOf,
    });

    this.deps.logger.info(
      {
        simulationId,
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
    context: { simulationId: string; characterId: string },
  ): Promise<void> {
    try {
      await this.deps.tokenUsage.record(billingUserId, usage);
    } catch (error) {
      this.deps.logger.warn(
        { ...context, billingUserId, err: describe(error) },
        "failed to record token usage",
      );
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
      simulationId: target.simulationId,
      activityId,
      targetPostId: target.id,
      threadRootId: target.threadRootId,
    };

    this.deps.events.publish(target.simulationId, { type: "response.started", ...shared });

    return {
      finish: (outcome) => {
        this.deps.events.publish(target.simulationId, {
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
    if (!this.deps.events.hasSubscribers(post.simulationId)) return;

    this.deps.events.publish(
      post.simulationId,
      await this.deps.threadActivity.buildThreadActivity(post),
    );
  }

  // -- helpers --------------------------------------------------------------

  private async requireSimulation(id: string): Promise<Simulation> {
    const simulation = await this.deps.simulations.findById(id);
    if (!simulation) throw new SimulationNotFoundError(id);
    return simulation;
  }

  private async assertPostBelongsToSimulation(
    postId: string | null | undefined,
    simulationId: string,
  ): Promise<void> {
    if (!postId) return;
    const post = await this.deps.posts.findById(postId);
    if (!post || post.simulationId !== simulationId) {
      throw new PostNotFoundError(postId);
    }
  }
}

export function toSimulationDto(simulation: Simulation): SimulationDto {
  return {
    id: simulation.id,
    title: simulation.title,
    status: simulation.status,
    createdAt: simulation.createdAt.toISOString(),
    ...(simulation.createdByUserId ? { createdByUserId: simulation.createdByUserId } : {}),
  };
}

/** The signed-in caller, reduced to what an ownership check needs (CLAUDE.md §66.6). */
export type SimulationActor = Pick<UserAccount, "id" | "isAdmin">;

/**
 * A simulation with no owner (created before login existed) matches no actor
 * id, so only an admin may manage it — mirrors the Character rule (§66.14),
 * even though Simulation ownership itself is public rather than private.
 */
export function isSimulationOwnerOrAdmin(
  simulation: Pick<Simulation, "createdByUserId">,
  actor: SimulationActor,
): boolean {
  return actor.isAdmin || actor.id === simulation.createdByUserId;
}

export function assertSimulationOwnerOrAdmin(
  simulation: Simulation,
  actor: SimulationActor,
): void {
  if (!isSimulationOwnerOrAdmin(simulation, actor)) {
    throw new SimulationForbiddenError(simulation.id);
  }
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
