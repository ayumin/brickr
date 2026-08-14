import {
  GLOBAL_SIMULATION_TITLE,
  type FeedFilter,
  type FeedPageDto,
  type FeedThreadDto,
  type PostDto,
} from "@brickr/shared";
import { DomainError } from "../domain-error.js";
import { optionalField } from "../persistence/repository-mapping.js";
import type { PostService } from "../posts/post-service.js";
import type { Post } from "../posts/post.js";
import { isGlobalSimulation } from "../simulation/simulation.js";
import type { SimulationRepository } from "../simulation/simulation-repository.js";
import {
  isSimulationOwnerOrAdmin,
  SimulationNotFoundError,
  type SimulationActor,
} from "../simulation/simulation-service.js";
import type { ThreadActivityEvent } from "../simulation/public-events.js";
import { toFeedCapabilities } from "./feed-capabilities.js";
import { decodeFeedCursor, encodeFeedCursor } from "./feed-cursor.js";
import type { FeedRepository, FeedRoom, FeedThreadRow } from "./feed-repository.js";

/**
 * A thread's root post could not be resolved — the id given is not a root, its
 * simulation is gone, or its room is stopped and the reader is not its owner
 * or an administrator. All four collapse to a 404, kept distinct from
 * simulation-service's PostNotFoundError (a reply/quote target outside the
 * current simulation) so the two unrelated meanings cannot be confused by an
 * `instanceof` check.
 */
export class ThreadRootNotFoundError extends DomainError {
  readonly httpStatus = 404;
  readonly errorCode = "not_found" as const;
  constructor(id: string) {
    super(`thread root "${id}" not found`);
  }
}

/**
 * Threads per page, fixed by the server (§9.4).
 *
 * Not a query parameter: the client cannot ask for a page size that would make
 * the feed slow, and a stored cursor keeps meaning the same thing.
 */
export const FEED_PAGE_SIZE = 20;

/** Preview depth in the feed. The rest is fetched when a thread is expanded (§12.2). */
export const REPLY_PREVIEW_COUNT = 2;

/**
 * Ceiling on one thread's reply list (§12.2). Phase 1 returns a thread whole; the
 * cap is what stops an unbounded response if a thread ever outgrows that, and
 * leaves room to page here later without changing the contract.
 */
export const THREAD_REPLIES_LIMIT = 500;

/**
 * Shown when a room has no name of its own.
 *
 * The feed always has a label to print (§9.3 types `title` as a plain string),
 * and a room created before naming was required has none. "ルーム" rather than
 * "シミュレーション": the internal term never reaches a screen (§4).
 */
const UNTITLED_ROOM_TITLE = "無題のルーム";

/** The signed-in reader, or `null` for an anonymous one — the feed is public (§10.1). */
export type FeedReader = (SimulationActor & { handle: string }) | null;

export type FeedPageRequest = {
  reader: FeedReader;
  filter: FeedFilter;
  /** The opaque cursor from the previous page, if any. */
  cursor?: string;
};

/**
 * Reads the feed: the unified one, one room's, and one thread's replies.
 *
 * The service owns what the feed *means* — ordering, paging, which threads
 * concern the reader, what the reader may do with each one — while the
 * repository owns how those rows are fetched.
 */
export class FeedService {
  constructor(
    private readonly feed: FeedRepository,
    private readonly posts: PostService,
    private readonly simulations: SimulationRepository,
  ) {}

  /**
   * Every room's threads plus the global feed's, newest activity first (§10.1).
   *
   * Readable without a session, which is why `reader` is nullable: an anonymous
   * visitor sees the same posts and no actions at all.
   */
  async getUnifiedFeed(request: FeedPageRequest): Promise<FeedPageDto> {
    return this.buildPage(request, {});
  }

  /**
   * One room's threads (§10.2).
   *
   * Refuses the global row: it is the feed, and asking for it as a room would
   * give the same posts a second, room-shaped surface. A stopped room answers as
   * if it did not exist unless the caller may read it, so the endpoint cannot be
   * used to discover somebody else's stopped rooms (§10.4).
   */
  async getRoomFeed(
    simulationId: string,
    request: FeedPageRequest & { reader: NonNullable<FeedReader> },
  ): Promise<FeedPageDto> {
    await this.assertRoomReadable(simulationId, request.reader);
    return this.buildPage(request, { simulationId });
  }

  /**
   * Whether this reader may read one room as a room (§10.2, §10.4).
   *
   * Shared with the room event stream (§11.1), so a subscription can never observe
   * a room the equivalent request would refuse.
   */
  async assertRoomReadable(
    simulationId: string,
    reader: NonNullable<FeedReader>,
  ): Promise<void> {
    const simulation = await this.simulations.findById(simulationId);
    if (!simulation || isGlobalSimulation(simulation)) {
      throw new SimulationNotFoundError(simulationId);
    }
    if (simulation.status === "stopped" && !isSimulationOwnerOrAdmin(simulation, reader)) {
      throw new SimulationNotFoundError(simulationId);
    }
  }

  /**
   * The thread a new post belongs to, as an event payload (§11.3).
   *
   * Built through the same `toThreadDto` the feed pages with, so a live update and
   * a fresh page describe the thread identically — the reply preview, the count,
   * the activity time and the room label cannot drift apart. Capabilities are left
   * at their anonymous baseline here and personalised per subscriber at delivery.
   */
  async buildThreadActivity(post: Post): Promise<ThreadActivityEvent> {
    const root =
      post.threadRootId === post.id ? post : await this.posts.findById(post.threadRootId);
    if (!root) throw new ThreadRootNotFoundError(post.threadRootId);

    const simulation = await this.simulations.findById(root.simulationId);
    if (!simulation) throw new SimulationNotFoundError(root.simulationId);

    const room: FeedRoom = {
      id: simulation.id,
      title: simulation.title,
      status: simulation.status,
      scope: simulation.scope,
      ...optionalField("createdByUserId", simulation.createdByUserId),
    };

    const [replyCounts, previews] = await Promise.all([
      this.feed.countRepliesByThread([root.id]),
      this.feed.findLatestRepliesByThread([root.id], REPLY_PREVIEW_COUNT),
    ]);
    const dtos = await this.posts.toDtos([root, ...previews]);

    const thread = this.toThreadDto({
      row: { root, room },
      reader: null,
      replyCount: replyCounts.get(root.id) ?? 0,
      previews,
      dtoById: new Map(dtos.map((dto) => [dto.id, dto])),
    });

    return { type: "thread.activity", simulationId: root.simulationId, room, thread };
  }

  /**
   * Every reply in one thread, oldest first (§12.2).
   *
   * Takes the thread root, not any post in it: a reply id would quietly return an
   * empty list, which reads like "no replies" rather than "wrong id".
   */
  async listThreadReplies(
    threadRootId: string,
    reader: NonNullable<FeedReader>,
  ): Promise<PostDto[]> {
    const root = await this.posts.findById(threadRootId);
    if (!root || root.replyTo !== null) throw new ThreadRootNotFoundError(threadRootId);

    const simulation = await this.simulations.findById(root.simulationId);
    if (!simulation) throw new ThreadRootNotFoundError(threadRootId);
    // Same rule as the thread detail: a stopped room stays readable in full for
    // its creator and an administrator, and is a 404 for everyone else (§10.8).
    if (simulation.status === "stopped" && !isSimulationOwnerOrAdmin(simulation, reader)) {
      throw new ThreadRootNotFoundError(threadRootId);
    }

    return this.posts.toDtos(
      await this.feed.findThreadReplies(threadRootId, THREAD_REPLIES_LIMIT),
    );
  }

  private async buildPage(
    request: FeedPageRequest,
    scope: { simulationId?: string },
  ): Promise<FeedPageDto> {
    const cursor = request.cursor === undefined ? undefined : decodeFeedCursor(request.cursor);
    const mine =
      request.filter === "mine" && request.reader
        ? { userId: request.reader.id, handle: request.reader.handle }
        : undefined;

    // One row beyond the page: enough to know whether a next page exists, without
    // counting the whole feed.
    const rows = await this.feed.findThreadPage({
      ...scope,
      ...(mine ? { mine } : {}),
      ...(cursor ? { cursor } : {}),
      limit: FEED_PAGE_SIZE + 1,
    });

    const page = rows.slice(0, FEED_PAGE_SIZE);
    const rootIds = page.map((row) => row.root.id);

    const [replyCounts, previews] = await Promise.all([
      this.feed.countRepliesByThread(rootIds),
      this.feed.findLatestRepliesByThread(rootIds, REPLY_PREVIEW_COUNT),
    ]);

    // Roots and previewed replies are mapped together, so authors and quoted
    // posts are looked up once for the entire page.
    const dtos = await this.posts.toDtos([...page.map((row) => row.root), ...previews]);
    const dtoById = new Map(dtos.map((dto) => [dto.id, dto]));
    const previewsByThread = groupByThread(previews);

    const threads = page.map((row) =>
      this.toThreadDto({
        row,
        reader: request.reader,
        replyCount: replyCounts.get(row.root.id) ?? 0,
        previews: previewsByThread.get(row.root.id) ?? [],
        dtoById,
      }),
    );

    return {
      threads,
      nextCursor: rows.length > FEED_PAGE_SIZE ? nextCursorOf(page) : null,
    };
  }

  private toThreadDto(input: {
    row: FeedThreadRow;
    reader: FeedReader;
    replyCount: number;
    previews: Post[];
    dtoById: Map<string, PostDto>;
  }): FeedThreadDto {
    const { row, reader, dtoById } = input;
    const root = dtoById.get(row.root.id);
    if (!root) throw new Error(`post "${row.root.id}" was not mapped`);

    const latestReplies = input.previews.flatMap((reply) => {
      const dto = dtoById.get(reply.id);
      return dto ? [dto] : [];
    });

    return {
      root,
      room: toRoomRef(row.room),
      latestReplies,
      replyCount: input.replyCount,
      lastActivityAt: row.root.threadActivityAt.toISOString(),
      capabilities: toFeedCapabilities({
        isSignedIn: reader !== null,
        isFeedRoom: isGlobalSimulation(row.room),
        isStoppedRoom: row.room.status === "stopped",
        isRoomOwnerOrAdmin: reader !== null && isSimulationOwnerOrAdmin(row.room, reader),
        replyCount: input.replyCount,
        previewedReplyCount: latestReplies.length,
      }),
    };
  }
}

/**
 * The global row is labelled as the feed, never as a room (§10.1). `isFeed` is
 * what the client keys on, so `scope` itself never leaves the backend.
 */
function toRoomRef(room: FeedRoom): FeedThreadDto["room"] {
  const isFeed = isGlobalSimulation(room);
  return {
    id: room.id,
    title: isFeed ? GLOBAL_SIMULATION_TITLE : (room.title ?? UNTITLED_ROOM_TITLE),
    isFeed,
  };
}

/** Preview replies arrive oldest first for the whole page; this keeps that order. */
function groupByThread(replies: Post[]): Map<string, Post[]> {
  const byThread = new Map<string, Post[]>();
  for (const reply of replies) {
    const thread = byThread.get(reply.threadRootId);
    if (thread) thread.push(reply);
    else byThread.set(reply.threadRootId, [reply]);
  }
  return byThread;
}

/** The last thread actually served is where the next page continues from (§9.4). */
function nextCursorOf(page: FeedThreadRow[]): string | null {
  const last = page.at(-1);
  return last
    ? encodeFeedCursor({ activityAt: last.root.threadActivityAt, id: last.root.id })
    : null;
}
