import type {
  SimulationDto,
  SimulationResponse,
  SimulationSummaryDto,
} from "@brickr/shared";
import { USER_AUTHOR_ID, USER_HANDLE } from "@brickr/shared";
import type { AgentService } from "../agents/agent-service.js";
import type { CharacterRepository } from "../characters/character-repository.js";
import type { Character } from "../characters/character.js";
import type { Post } from "../posts/post.js";
import type { PostService } from "../posts/post-service.js";
import type { ThreadService } from "../posts/thread-service.js";
import { resolveActionTargets, selectAction } from "./action-selector.js";
import { runWithConcurrency } from "./concurrency.js";
import type { EventHub } from "./event-hub.js";
import { selectResponders, shouldRespond } from "./responder-selector.js";
import type { SimulationRepository } from "./simulation-repository.js";
import type { Simulation } from "./simulation.js";

/** Hard ceiling on character posts generated from one user post. */
const MAX_POSTS_PER_SUBMISSION = 24;
/** How many characters may pile onto a single character post in a cascade round. */
const MAX_CASCADE_RESPONDERS = 2;

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

export class SimulationNotFoundError extends Error {
  constructor(id: string) {
    super(`simulation "${id}" not found`);
    this.name = "SimulationNotFoundError";
  }
}

export class SimulationStoppedError extends Error {
  constructor(id: string) {
    super(`simulation "${id}" has been stopped`);
    this.name = "SimulationStoppedError";
  }
}

export class PostNotFoundError extends Error {
  constructor(id: string) {
    super(`post "${id}" not found`);
    this.name = "PostNotFoundError";
  }
}

/**
 * Orchestrates a round of character reactions to a post.
 *
 * There is no round or wave model (CLAUDE.md §31): every character reads the
 * thread as it exists the moment that character starts working, so characters
 * that start later legitimately see more.
 */
export class SimulationService {
  /** Tracks in-flight generation per simulation so `stop` can take effect. */
  private readonly stopped = new Set<string>();

  constructor(
    private readonly simulations: SimulationRepository,
    private readonly posts: PostService,
    private readonly characters: CharacterRepository,
    private readonly threads: ThreadService,
    private readonly agents: AgentService,
    private readonly events: EventHub,
    private readonly options: SimulationServiceOptions,
    private readonly logger: SimulationLogger,
  ) {}

  async create(title: string | null): Promise<SimulationDto> {
    const simulation = await this.simulations.create(title);
    this.stopped.delete(simulation.id);
    return toSimulationDto(simulation);
  }

  async list(): Promise<SimulationSummaryDto[]> {
    const simulations = await this.simulations.findAll();
    return simulations.map((simulation) => ({
      ...toSimulationDto(simulation),
      postCount: simulation.postCount,
    }));
  }

  async get(id: string): Promise<SimulationResponse> {
    const simulation = await this.requireSimulation(id);
    const posts = await this.posts.listBySimulation(id);
    return { simulation: toSimulationDto(simulation), posts };
  }

  async rename(id: string, title: string): Promise<SimulationDto> {
    await this.requireSimulation(id);
    return toSimulationDto(await this.simulations.updateTitle(id, title));
  }

  async stop(id: string): Promise<SimulationDto> {
    await this.requireSimulation(id);
    this.stopped.add(id);
    const simulation = await this.simulations.updateStatus(id, "stopped");
    return toSimulationDto(simulation);
  }

  async resume(id: string): Promise<SimulationDto> {
    await this.requireSimulation(id);
    this.stopped.delete(id);
    const simulation = await this.simulations.updateStatus(id, "active");
    return toSimulationDto(simulation);
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

    const post = await this.posts.publish({
      simulationId: input.simulationId,
      authorId: input.authorId,
      content: input.content,
      ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
      replyTo: input.replyTo ?? null,
      quoteOf: input.quoteOf ?? null,
    });

    await this.emitPostCreated(post);

    // Fire and forget: the HTTP response returns now, posts stream over SSE.
    void this.runGeneration(post, input.responderIds).catch((error: unknown) => {
      this.logger.error(
        { simulationId: input.simulationId, err: describe(error) },
        "simulation run failed",
      );
      this.events.publish({
        type: "simulation.failed",
        simulationId: input.simulationId,
        reason: describe(error),
      });
    });

    return post;
  }

  // -- generation -----------------------------------------------------------

  private async runGeneration(triggerPost: Post, explicitIds: string[]): Promise<void> {
    const generatedIds: string[] = [];
    const budget = { remaining: MAX_POSTS_PER_SUBMISSION };

    try {
      const all = await this.characters.findAll();

      const { all: responders } = selectResponders({
        characters: all,
        mentionedHandles: triggerPost.mentions,
        explicitIds,
        excludeIds: [triggerPost.authorId],
        minResponders: this.options.minResponders,
        maxResponders: this.options.maxResponders,
      });

      await this.runRound({
        target: triggerPost,
        responders,
        allCharacters: all,
        depth: 0,
        generatedIds,
        budget,
      });
    } finally {
      this.events.publish({
        type: "simulation.completed",
        simulationId: triggerPost.simulationId,
        triggerPostId: triggerPost.id,
        generatedPostIds: generatedIds,
      });
    }
  }

  /** Runs one set of characters against one target post, then cascades. */
  private async runRound(input: {
    target: Post;
    responders: Character[];
    allCharacters: Character[];
    depth: number;
    generatedIds: string[];
    budget: { remaining: number };
  }): Promise<void> {
    const { target, responders, allCharacters, depth, generatedIds, budget } = input;
    if (responders.length === 0 || budget.remaining <= 0) return;

    const slice = responders.slice(0, budget.remaining);
    budget.remaining -= slice.length;

    const results = await runWithConcurrency(
      slice,
      this.options.maxConcurrentCharacters,
      (character) => this.processCharacter(character, target, allCharacters),
    );

    for (const result of results) {
      if ("value" in result && result.value !== null) {
        generatedIds.push(result.value.id);
      }
    }

    if (depth >= this.options.maxCascadeDepth) return;

    // Characters react to what the previous round produced. Done sequentially
    // per post but concurrently within each cascade round.
    const cascades: Array<Promise<void>> = [];

    for (const result of results) {
      if (!("value" in result) || result.value === null) continue;
      if (budget.remaining <= 0) break;

      const producedPost = result.value;
      const author = result.item;

      const followers = this.selectCascadeResponders({
        allCharacters,
        producedPost,
        author,
        depth,
      });
      if (followers.length === 0) continue;

      cascades.push(
        this.runRound({
          target: producedPost,
          responders: followers,
          allCharacters,
          depth: depth + 1,
          generatedIds,
          budget,
        }),
      );
    }

    await Promise.all(cascades);
  }

  /**
   * Who reacts to a character's post: anyone it @mentioned (always), plus a
   * couple of opportunistic reactions gated by `shouldRespond`.
   */
  private selectCascadeResponders(input: {
    allCharacters: Character[];
    producedPost: Post;
    author: Character;
    depth: number;
  }): Character[] {
    const { allCharacters, producedPost, author, depth } = input;

    const byHandle = new Map(
      allCharacters.map((character) => [character.handle.toLowerCase(), character]),
    );

    const chosen = new Map<string, Character>();

    for (const handle of producedPost.mentions) {
      const mentioned = byHandle.get(handle);
      if (mentioned && mentioned.id !== author.id) chosen.set(mentioned.id, mentioned);
    }

    const opportunistic = allCharacters.filter(
      (character) =>
        character.id !== author.id &&
        !chosen.has(character.id) &&
        shouldRespond(character, { authorInfluence: author.influence, depth }),
    );

    for (const character of opportunistic.slice(0, MAX_CASCADE_RESPONDERS)) {
      chosen.set(character.id, character);
    }

    return [...chosen.values()];
  }

  /**
   * One character's turn: read the thread as it stands *now*, pick an action,
   * generate, persist, publish.
   *
   * Returns the post it produced, or null if it stayed quiet or failed.
   */
  private async processCharacter(
    character: Character,
    target: Post,
    allCharacters: Character[],
  ): Promise<Post | null> {
    const simulationId = target.simulationId;
    if (this.stopped.has(simulationId)) return null;

    this.events.publish({
      type: "character.processing",
      simulationId,
      targetPostId: target.id,
      characterId: character.id,
      handle: character.handle,
      displayName: character.displayName,
    });

    try {
      // Context is read immediately before the LLM call (CLAUDE.md §32).
      const thread = await this.threads.getCurrentThread(target.id);
      if (!thread) {
        this.publishSkipped(simulationId, character.id);
        return null;
      }

      const action = selectAction({
        character,
        target: thread.target,
        threadPosts: thread.posts,
      });

      // The transcript names users by handle too, so a character can react to
      // the person who wrote the post rather than to an opaque id.
      const users = await this.posts.findUsersByIds(
        [thread.target, ...thread.posts].map((post) => post.authorId),
      );
      const handleOf = buildHandleResolver(allCharacters, users);

      const generated = await this.agents.generate({
        character,
        target: thread.target,
        posts: thread.posts,
        action,
        resolveHandle: handleOf,
      });

      if (this.stopped.has(simulationId)) return null;

      const { replyTo, quoteOf } = resolveActionTargets(action, thread.target);

      const post = await this.posts.publish({
        simulationId,
        authorId: character.id,
        content: generated.content,
        replyTo,
        quoteOf,
      });

      this.logger.info(
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
    } catch (error) {
      this.logger.warn(
        { simulationId, characterId: character.id, err: describe(error) },
        "character generation failed",
      );
      this.events.publish({
        type: "character.failed",
        simulationId,
        characterId: character.id,
        reason: describe(error),
      });
      return null;
    }
  }

  private publishSkipped(simulationId: string, characterId: string): void {
    this.events.publish({ type: "character.skipped", simulationId, characterId });
  }

  private async emitPostCreated(post: Post): Promise<void> {
    const dto = await this.posts.toDto(post);
    this.events.publish({
      type: "post.created",
      simulationId: post.simulationId,
      post: dto,
    });
  }

  // -- helpers --------------------------------------------------------------

  private async requireSimulation(id: string): Promise<Simulation> {
    const simulation = await this.simulations.findById(id);
    if (!simulation) throw new SimulationNotFoundError(id);
    return simulation;
  }

  private async assertPostBelongsToSimulation(
    postId: string | null | undefined,
    simulationId: string,
  ): Promise<void> {
    if (!postId) return;
    const post = await this.posts.findById(postId);
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
