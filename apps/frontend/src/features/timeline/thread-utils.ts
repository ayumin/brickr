/**
 * Derived-thread helpers.
 *
 * Pure functions over `PostDto[]` — no React, no fetch, no mutation of the
 * inputs. The frontend already holds every post in the simulation (REST
 * hydration + SSE), so every view below is derived state rather than a new
 * endpoint.
 *
 * Terminology used here (matches the backend, CLAUDE.md §28, §36, §38):
 * - thread starter : `replyTo === null`
 * - reply          : `replyTo !== null`
 * - repost         : `quoteOf !== null` — a quote post IS the repost mechanism
 *
 * A pure repost has `replyTo === null`, so it is never counted as a reply.
 * If a post ever carried both fields, `replyTo` wins: it explicitly points
 * into a thread, and the flat expansion has to show it for the reply count to
 * stay consistent with what expanding reveals.
 */
import type { PostDto } from "@brickr/shared";

/** postId → its direct replies, oldest first. */
export type ReplyIndex = ReadonlyMap<string, readonly PostDto[]>;

/** postId → the posts that quote (repost) it, oldest first. */
export type RepostIndex = ReadonlyMap<string, readonly PostDto[]>;

/** Oldest first; ids break ties so equal timestamps stay stable. */
export function comparePostsChronological(a: PostDto, b: PostDto): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? -1 : 1;
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
}

/** Newest first, the ordering used by the home and author timelines. */
export function comparePostsNewestFirst(a: PostDto, b: PostDto): number {
  return -comparePostsChronological(a, b);
}

/** True for a post that starts a thread rather than continuing one. */
export function isThreadStarter(post: PostDto): boolean {
  return post.replyTo === null;
}

/** True for a repost (quote post). */
export function isRepost(post: PostDto): boolean {
  return post.quoteOf !== null;
}

/** Convenience lookup used to resolve `replyTo` ids to the actual post. */
export function indexPostsById(
  posts: readonly PostDto[],
): ReadonlyMap<string, PostDto> {
  const byId = new Map<string, PostDto>();
  for (const post of posts) {
    byId.set(post.id, post);
  }
  return byId;
}

/**
 * Reference rendered as a separate context card in the post detail view.
 *
 * A quoted post is normally already embedded in `PostCard`, so it does not
 * need a second card. A reply is not embedded and therefore returns its
 * parent. If legacy/corrupt data contains both relationships, the explicit
 * reply relationship wins and the detail view still shows only one reference.
 */
export function selectSeparateDetailReferenceId(post: PostDto): string | null {
  if (post.replyTo !== null) {
    return post.replyTo;
  }
  return post.quotedPost === null ? post.quoteOf : null;
}

/**
 * Group replies by the post they answer.
 *
 * Reposts are not replies, so a post whose `replyTo` is null never lands in
 * the index — which is what keeps them out of every reply count.
 */
export function buildReplyIndex(posts: readonly PostDto[]): ReplyIndex {
  const index = new Map<string, PostDto[]>();

  for (const post of posts) {
    const parentId = post.replyTo;
    if (parentId === null || parentId === post.id) {
      // Null: a thread starter. Self-reference: corrupt data, ignore it.
      continue;
    }
    const bucket = index.get(parentId);
    if (bucket) {
      bucket.push(post);
    } else {
      index.set(parentId, [post]);
    }
  }

  for (const bucket of index.values()) {
    bucket.sort(comparePostsChronological);
  }

  return index;
}

/**
 * Group reposts by the post they quote.
 *
 * A repost IS a quote post, so `quoteOf` is the repost mechanism. Reposts do
 * not nest in the UI, so this index is only ever read one level deep.
 */
export function buildRepostIndex(posts: readonly PostDto[]): RepostIndex {
  const index = new Map<string, PostDto[]>();

  for (const post of posts) {
    const quotedId = post.quoteOf;
    if (quotedId === null || quotedId === post.id) {
      continue;
    }
    const bucket = index.get(quotedId);
    if (bucket) {
      bucket.push(post);
    } else {
      index.set(quotedId, [post]);
    }
  }

  for (const bucket of index.values()) {
    bucket.sort(comparePostsChronological);
  }

  return index;
}

/** The reposts of one post, oldest first. Never undefined. */
export function selectReposts(
  index: RepostIndex,
  postId: string,
): readonly PostDto[] {
  return index.get(postId) ?? [];
}

/** Direct repost count. Not transitive: reposts do not nest. */
export function countReposts(index: RepostIndex, postId: string): number {
  return selectReposts(index, postId).length;
}

/** Direct replies to one post, oldest first. Never undefined. */
export function getDirectReplies(
  index: ReplyIndex,
  postId: string,
): readonly PostDto[] {
  return index.get(postId) ?? [];
}

/**
 * Every transitive descendant of a post as ONE flat chronological array.
 *
 * The UI renders replies flat (a reply-to-a-reply sits at the same indent as a
 * direct reply), so the traversal collapses the tree and then sorts by time.
 * A `visited` set makes it cycle-safe: bad data must not hang the UI.
 */
export function flattenReplies(index: ReplyIndex, postId: string): PostDto[] {
  const collected: PostDto[] = [];
  const visited = new Set<string>([postId]);
  const queue: string[] = [postId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (currentId === undefined) {
      break;
    }
    for (const reply of getDirectReplies(index, currentId)) {
      if (visited.has(reply.id)) {
        continue;
      }
      visited.add(reply.id);
      collected.push(reply);
      queue.push(reply.id);
    }
  }

  return collected.sort(comparePostsChronological);
}

/**
 * Transitive reply count.
 *
 * Deliberately defined as the size of the flat expansion so the number in
 * 「返信を表示 (N)」 always matches the rows the expander reveals.
 */
export function countReplies(index: ReplyIndex, postId: string): number {
  return flattenReplies(index, postId).length;
}

/**
 * The signed-in user's home timeline: their thread starters plus every post
 * that mentions their handle. Replies still live inside their thread unless
 * somebody explicitly mentions them in that reply.
 */
export function selectUserTimeline(
  posts: readonly PostDto[],
  userAuthorId: string,
  userHandle: string,
): PostDto[] {
  return posts
    .filter(
      (post) =>
        (isAuthoredBy(post, userAuthorId) && isThreadStarter(post)) ||
        isMentioned(post, userHandle),
    )
    .sort(comparePostsNewestFirst);
}

/** True when a post belongs to the given author id (§9.1: `author.id`, nothing else). */
function isAuthoredBy(post: PostDto, authorId: string): boolean {
  return post.author.id === authorId;
}

/** Mention handles are normalized to lowercase by the backend. */
function isMentioned(post: PostDto, handle: string | undefined): boolean {
  if (!handle) return false;
  const normalized = handle.toLowerCase();
  return post.mentions.some((mention) => mention.toLowerCase() === normalized);
}

/**
 * One identity's timeline: everything they authored plus every post that
 * mentions their handle, newest first.
 */
export function selectAuthorTimeline(
  posts: readonly PostDto[],
  authorId: string,
  handle?: string,
): PostDto[] {
  return posts
    .filter((post) => isAuthoredBy(post, authorId) || isMentioned(post, handle))
    .sort(comparePostsNewestFirst);
}
