import type { FeedThreadDto } from "./feed.js";
import type { PublicAccountDto } from "./public-profile.js";

/**
 * Denormalised author info so the timeline can render without extra lookups.
 *
 * Derived from `PublicAccountDto` so a post author and a public profile can
 * never drift apart: whether the account is a person or a character is
 * deliberately absent from both (Brickr-ux-refine §9.1).
 */
export type PostAuthorDto = Pick<
  PublicAccountDto,
  "id" | "handle" | "displayName" | "avatarUrl"
>;

/** A quoted post, flattened one level deep (no recursive quoting in the UI). */
export type QuotedPostDto = {
  id: string;
  author: PostAuthorDto;
  content: string;
  imageUrl?: string;
  createdAt: string;
};

export type PostDto = {
  id: string;
  roomId: string;
  /**
   * No sibling `authorId`: the id lives on `author` alone, so "is this mine?" is
   * always `post.author.id === sessionUser.id` (§9.1).
   */
  author: PostAuthorDto;
  content: string;
  /** Optional image attachment. Only allowed on a top-level user post. */
  imageUrl?: string;
  /** Handles mentioned in the body, without the leading "@". */
  mentions: string[];
  replyTo: string | null;
  quoteOf: string | null;
  quotedPost: QuotedPostDto | null;
  createdAt: string;
};

export type CreatePostRequest = {
  content: string;
  imageUrl?: string;
  /** Characters the user explicitly asks to respond. */
  responderIds?: string[];
  /** Set when the user replies to an existing post. */
  replyTo?: string;
  /** Set when the user quotes an existing post. */
  quoteOf?: string;
};

/**
 * The created post, plus the thread it now belongs to (§13.4).
 *
 * `thread` exists so the feed can show your own post the moment it is accepted,
 * without rebuilding what the server already knows. The alternative — deriving a
 * thread from `post` on the client — would reimplement the reply preview, the
 * reply count and `capabilities` a second time and drift from the feed (§11.3).
 *
 * It is the same shape `feed.post-created` carries, keyed by the same
 * `thread.root.id`, so the stream's echo of this post updates the entry this
 * response created instead of duplicating it.
 */
export type CreatePostResponse = {
  post: PostDto;
  thread: FeedThreadDto;
};

export type PostsResponse = {
  posts: PostDto[];
};

/**
 * A cursor-paged slice of one account's posts (§10.6).
 *
 * The cursor is opaque and server-issued, exactly like the feed's (§9.4):
 * `null` means there is nothing older left to read.
 */
export type PostsPageResponse = {
  posts: PostDto[];
  nextCursor: string | null;
};
