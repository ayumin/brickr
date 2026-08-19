import type { Post } from "./post.js";
import type { PostRepository } from "./post-repository.js";

/** Guard against a pathological reply chain (or a cycle from bad data). */
const MAX_ANCESTOR_DEPTH = 20;

export type ThreadContext = {
  /** The post the character is reacting to. Always present in `posts`. */
  target: Post;
  /** Chronological, de-duplicated, capped at the configured limit. */
  posts: Post[];
};

function sortChronologically(posts: Post[]): Post[] {
  return [...posts].sort((a, b) => {
    const delta = a.createdAt.getTime() - b.createdAt.getTime();
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });
}

export type ContextSelectionInput = {
  /**
   * Posts structurally related to the target: its ancestors, the target itself,
   * and the replies and quotes hanging off it. These win the budget.
   */
  threadPosts: Post[];
  /**
   * Recent posts from elsewhere in the room. Useful colour, but only
   * filler — they are dropped first when the budget is tight.
   */
  ambientPosts: Post[];
  target: Post;
  limit: number;
};

/**
 * Chooses which posts a character actually sees, within a budget.
 *
 * Thread posts are privileged over ambient ones. Merging both into one flat
 * "keep the newest N" pool looks simpler but silently breaks the conversation:
 * once a room has more than `limit` recent posts, a character replying
 * deep in a thread loses that thread's own root and parent, and answers
 * something it can no longer see.
 *
 * Pure so it can be unit tested without a database.
 */
export function selectContextPosts(input: ContextSelectionInput): Post[] {
  const { target } = input;
  // A budget below 1 cannot be honoured — the target itself is mandatory.
  const cap = Math.max(1, input.limit);

  const kept = new Map<string, Post>();
  kept.set(target.id, target);

  // Newest-first so that trimming sheds the oldest, least relevant context.
  const byRecencyDesc = (posts: Post[]): Post[] => sortChronologically(posts).reverse();

  for (const group of [input.threadPosts, input.ambientPosts]) {
    for (const post of byRecencyDesc(group)) {
      if (kept.size >= cap) break;
      kept.set(post.id, post);
    }
  }

  return sortChronologically([...kept.values()]);
}

/**
 * Builds the conversation context a character sees.
 *
 * Read at the moment a character starts working (see CLAUDE.md §30/§32): posts
 * created after this call are deliberately not included in that LLM request.
 */
export class ThreadService {
  constructor(
    private readonly posts: PostRepository,
    private readonly contextLimit: number | (() => number),
  ) {}

  async getCurrentThread(targetPostId: string): Promise<ThreadContext | null> {
    const target = await this.posts.findById(targetPostId);
    if (!target) return null;

    // Posts structurally tied to the target. Kept separate from ambient context
    // so they cannot be squeezed out of the budget by unrelated chatter.
    const thread = new Map<string, Post>();
    thread.set(target.id, target);

    // Walk up the reply chain, pulling in each step's quoted post too.
    let cursor: Post | null = target;
    for (let depth = 0; depth < MAX_ANCESTOR_DEPTH && cursor !== null; depth += 1) {
      const current: Post = cursor;

      const wanted = [current.replyTo, current.quoteOf].filter(
        (id): id is string => id !== null && !thread.has(id),
      );
      if (wanted.length > 0) {
        for (const parent of await this.posts.findManyByIds(wanted)) {
          thread.set(parent.id, parent);
        }
      }

      // Keep climbing the reply chain; quoted posts are leaves for context.
      cursor = current.replyTo ? (thread.get(current.replyTo) ?? null) : null;
    }

    // Pull in siblings: replies and quotes hanging off the target itself.
    const [replies, quotes] = await Promise.all([
      this.posts.findReplies(target.id),
      this.posts.findQuotes(target.id),
    ]);
    for (const post of [...replies, ...quotes]) thread.set(post.id, post);

    // Ambient context: what else has been said in this room lately.
    const contextLimit =
      typeof this.contextLimit === "function" ? this.contextLimit() : this.contextLimit;
    const recent = await this.posts.findRecentByRoom(
      target.roomId,
      contextLimit,
    );

    return {
      target,
      posts: selectContextPosts({
        threadPosts: [...thread.values()],
        ambientPosts: recent.filter((post) => !thread.has(post.id)),
        target,
        limit: contextLimit,
      }),
    };
  }
}
