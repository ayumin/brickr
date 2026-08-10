import type { PostAuthorDto, PostDto, QuotedPostDto } from "@enjo/shared";
import { USER_AUTHOR_ID, USER_DISPLAY_NAME, USER_HANDLE } from "@enjo/shared";
import type { Character } from "../characters/character.js";
import type { Post } from "./post.js";

export const USER_AUTHOR: PostAuthorDto = {
  id: USER_AUTHOR_ID,
  kind: "user",
  handle: USER_HANDLE,
  displayName: USER_DISPLAY_NAME,
};

/**
 * Resolves an author id to the denormalised author DTO the timeline renders.
 * Unknown ids fall back to a placeholder rather than throwing — a deleted
 * character must not break an existing timeline.
 */
export function toAuthorDto(
  authorId: string,
  charactersById: Map<string, Character>,
): PostAuthorDto {
  if (authorId === USER_AUTHOR_ID) return USER_AUTHOR;

  const character = charactersById.get(authorId);
  if (!character) {
    return { id: authorId, kind: "character", handle: authorId, displayName: authorId };
  }

  return {
    id: character.id,
    kind: "character",
    handle: character.handle,
    displayName: character.displayName,
    ...(character.avatarUrl ? { avatarUrl: character.avatarUrl } : {}),
  };
}

function toQuotedPostDto(
  post: Post,
  charactersById: Map<string, Character>,
): QuotedPostDto {
  return {
    id: post.id,
    author: toAuthorDto(post.authorId, charactersById),
    content: post.content,
    createdAt: post.createdAt.toISOString(),
  };
}

export function toPostDto(
  post: Post,
  charactersById: Map<string, Character>,
  quotedPost: Post | null,
): PostDto {
  return {
    id: post.id,
    simulationId: post.simulationId,
    authorId: post.authorId,
    author: toAuthorDto(post.authorId, charactersById),
    content: post.content,
    mentions: post.mentions,
    replyTo: post.replyTo,
    quoteOf: post.quoteOf,
    quotedPost: quotedPost ? toQuotedPostDto(quotedPost, charactersById) : null,
    createdAt: post.createdAt.toISOString(),
  };
}

/** Maps a batch of posts, resolving `quoteOf` against the same batch first. */
export function toPostDtos(
  posts: Post[],
  charactersById: Map<string, Character>,
  extraQuoted: Post[] = [],
): PostDto[] {
  const byId = new Map<string, Post>();
  for (const post of [...posts, ...extraQuoted]) byId.set(post.id, post);

  return posts.map((post) =>
    toPostDto(post, charactersById, post.quoteOf ? (byId.get(post.quoteOf) ?? null) : null),
  );
}
