/** Where a post came from. The user and characters share one post model. */
export type AuthorKind = "user" | "character";

/** Denormalised author info so the timeline can render without extra lookups. */
export type PostAuthorDto = {
  id: string;
  kind: AuthorKind;
  handle: string;
  displayName: string;
  avatarUrl?: string;
};

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
  simulationId: string;
  authorId: string;
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

export type CreatePostResponse = {
  post: PostDto;
};

export type PostsResponse = {
  posts: PostDto[];
};
