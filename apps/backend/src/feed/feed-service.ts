import {
  type FeedFilter,
  type FeedPageDto,
  type FeedThreadDto,
  type PostDto,
} from "@brickr/shared";
import { DomainError } from "../domain-error.js";
import { optionalField } from "../persistence/repository-mapping.js";
import type { PostService } from "../posts/post-service.js";
import type { Post } from "../posts/post.js";
import type { SimulationRepository } from "../simulation/simulation-repository.js";
import {
  assertRoomReadable,
  isSimulationOwnerOrAdmin,
  SimulationNotFoundError,
  type SimulationActor,
} from "../simulation/simulation-service.js";
import type { ThreadActivityEvent } from "../simulation/public-events.js";
import { toFeedCapabilities } from "./feed-capabilities.js";
import { decodeFeedCursor, encodeFeedCursor } from "./feed-cursor.js";
import type { FeedRepository, FeedRoom, FeedThreadRow } from "./feed-repository.js";
import { withReaderCapabilities } from "./public-events.js";

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
   *
   * Visibility filtering: closed and private rooms are excluded for readers who
   * are not active members. Public and open rooms are always included. The global
   * simulation row is always included regardless of visibility (§10.1).
   */
  async getUnifiedFeed(request: FeedPageRequest): Promise<FeedPageDto> {
    const visibleRoomIds = await this.feed.findVisibleRoomIds(
      request.reader ? request.reader.id : null,
      request.reader?.isAdmin ?? false,
    );
    return this.buildPage(request, { visibleRoomIds });
  }

  /**
   * One room's threads (§10.2).
   *
   * Refuses the global row: it is the feed, and asking for it as a room would
   * give the same posts a second, room-shaped surface. A stopped room answers as
   * if it did not exist unless the caller may read it, so the endpoint cannot be
   * used to discover somebody else's stopped rooms (§10.4).
   *
   * Visibility enforcement: closed and private rooms are refused for readers who
   * are not active members, using the same 404 response as a stopped room so the
   * endpoint cannot be used to discover rooms the caller cannot access (§10.4).
   */
  async getRoomFeed(
    simulationId: string,
    request: FeedPageRequest & { reader: NonNullable<FeedReader> },
  ): Promise<FeedPageDto> {
    await this.assertRoomFeedReadable(simulationId, request.reader);
    return this.buildPage(request, { simulationId });
  }

  /**
   * Whether this reader may read one room as a room (§10.2, §10.4).
   *
   * Shared with the room event stream (§11.1), so a subscription can never observe
   * a room the equivalent request would refuse.
   *
   * Enforces visibility for closed/private rooms: a reader who is not an active
   * member receives a 404, indistinguishable from a room that does not exist.
   */
  async assertRoomFeedReadable(
    simulationId: string,
    reader: NonNullable<FeedReader>,
  ): Promise<void> {
    const simulation = await this.simulations.findById(simulationId);
    if (!simulation) throw new SimulationNotFoundError(simulationId);
    assertRoomReadable(simulation, reader);

    // Public/open rooms are readable without a membership. Owners and admins
    // retain the same bypass used by the rest of the room authorization flow.
    // For closed/private rooms, query only this room's membership instead of
    // materialising every room visible to the reader.
    if (
      simulation.status === "active" &&
      (simulation.visibility === "closed" || simulation.visibility === "private") &&
      !isSimulationOwnerOrAdmin(simulation, reader)
    ) {
      const isMember = await this.feed.hasActiveRoomMembership(simulationId, reader.id);
      if (!isMember) {
        throw new SimulationNotFoundError(simulationId);
      }
    }
  }

  /**
   * One post as the feed would show it, for the thread detail (§10.8).
   *
   * Returns `null` both when the post does not exist and when its room is
   * stopped and the reader is neither its creator nor an administrator, so the
   * route has a single 404 path and cannot accidentally distinguish "hidden"
   * from "absent" — the distinction is what makes a 403 a discovery tool.
   *
   * A post in the global feed row is readable by every signed-in caller: unlike
   * a room, the feed is where all history stays visible (§10.8).
   */
  async findVisiblePost(
    id: string,
    reader: NonNullable<FeedReader>,
  ): Promise<PostDto | null> {
    const post = await this.posts.findById(id);
    if (!post) return null;

    const simulation = await this.simulations.findById(post.roomId);
    if (!simulation) return null;
    if (simulation.status === "archived" && !isSimulationOwnerOrAdmin(simulation, reader)) {
      return null;
    }

    return this.posts.toDto(post);
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

    const simulation = await this.simulations.findById(root.roomId);
    if (!simulation) throw new SimulationNotFoundError(root.roomId);

    const room: FeedRoom = {
      id: simulation.id,
      title: simulation.title,
      status: simulation.status,
      scope: simulation.scope,
      visibility: simulation.visibility,
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

    return {
      type: "thread.activity",
      simulationId: root.roomId,
      postId: post.id,
      room,
      thread,
    };
  }

  /**
   * The thread a just-created post belongs to, as its author may see it (§13.4).
   *
   * Built from `buildThreadActivity`, so the response to a post and the event the
   * stream sends for that same post are the one thread described once. The feed
   * keys both on `thread.root.id`, which is what lets the echo update the entry
   * this response created rather than adding a second copy of it.
   */
  async buildThreadForReader(
    post: Post,
    reader: NonNullable<FeedReader>,
  ): Promise<FeedThreadDto> {
    const activity = await this.buildThreadActivity(post);
    return withReaderCapabilities(activity.thread, activity.room, reader);
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

    const simulation = await this.simulations.findById(root.roomId);
    if (!simulation) throw new ThreadRootNotFoundError(threadRootId);
    // Same rule as the thread detail: an archived room stays readable in full for
    // its creator and an administrator, and is a 404 for everyone else (§10.8).
    if (simulation.status === "archived" && !isSimulationOwnerOrAdmin(simulation, reader)) {
      throw new ThreadRootNotFoundError(threadRootId);
    }

    return this.posts.toDtos(
      await this.feed.findThreadReplies(threadRootId, THREAD_REPLIES_LIMIT),
    );
  }

  private async buildPage(
    request: FeedPageRequest,
    scope: { simulationId?: string; visibleRoomIds?: string[] },
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

    const [replyCounts, previews, concerningReplyByThread] = await Promise.all([
      this.feed.countRepliesByThread(rootIds),
      this.feed.findLatestRepliesByThread(rootIds, REPLY_PREVIEW_COUNT),
      mine ? this.feed.findConcerningReplyByThread(rootIds, mine) : Promise.resolve(new Map<string, Post>()),
    ]);

    const previewsByThread = groupByThread(previews);
    // Under `mine`, a reply that concerns the reader can be older than this
    // thread's `REPLY_PREVIEW_COUNT` most-recent replies and so absent from
    // `previews` above - back it in rather than let newer, unrelated replies
    // hide the one reason this thread qualifies as "自分あて" (§12.3).
    for (const [threadId, concerning] of concerningReplyByThread) {
      previewsByThread.set(threadId, withConcerningReply(previewsByThread.get(threadId) ?? [], concerning));
    }
    const allPreviews = [...previewsByThread.values()].flat();

    // Roots and previewed replies are mapped together, so authors and quoted
    // posts are looked up once for the entire page.
    const dtos = await this.posts.toDtos([...page.map((row) => row.root), ...allPreviews]);
    const dtoById = new Map(dtos.map((dto) => [dto.id, dto]));

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
        isStoppedRoom: row.room.status === "archived",
        isRoomOwnerOrAdmin: reader !== null && isSimulationOwnerOrAdmin(row.room, reader),
        replyCount: input.replyCount,
        previewedReplyCount: latestReplies.length,
      }),
    };
  }
}

/**
 * Feed DTOs always reference a real room. The cross-room feed itself is a view
 * selected by `ThreadFeedSource`, not a synthetic room exposed to clients.
 */
function toRoomRef(room: FeedRoom): FeedThreadDto["room"] {
  return {
    id: room.id,
    title: room.title ?? UNTITLED_ROOM_TITLE,
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

/**
 * Backfills one thread's preview with the reply that concerns the reader
 * under `mine`, if it was pushed out by newer, unrelated replies (§12.3).
 *
 * `concerning` is undefined for a thread with no such reply. If it is already
 * among `previews` there is nothing to do. Otherwise, since `previews` is
 * already "this thread's most recent replies", a `concerning` reply absent
 * from it is necessarily older than every one of them - so the result keeps
 * only the single newest existing preview alongside it, re-sorted oldest
 * first, rather than growing past `REPLY_PREVIEW_COUNT`.
 */
function withConcerningReply(previews: Post[], concerning: Post | undefined): Post[] {
  if (!concerning || previews.some((post) => post.id === concerning.id)) {
    return previews;
  }
  const kept = previews.slice(-(REPLY_PREVIEW_COUNT - 1));
  const merged = [concerning, ...kept];
  return merged.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
}

/** The last thread actually served is where the next page continues from (§9.4). */
function nextCursorOf(page: FeedThreadRow[]): string | null {
  const last = page.at(-1);
  return last
    ? encodeFeedCursor({ activityAt: last.root.threadActivityAt, id: last.root.id })
    : null;
}
