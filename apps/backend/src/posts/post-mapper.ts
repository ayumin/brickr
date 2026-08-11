import type { PostAuthorDto, PostDto, QuotedPostDto } from "@brickr/shared";
import type { Character } from "../characters/character.js";
import type { UserProfile } from "../user-profile/user-profile.js";
import type { Post } from "./post.js";

/**
 * Resolves an author id to the denormalised author DTO the timeline renders.
 *
 * Users are looked up by id like characters are, rather than compared against a
 * fixed id: several people can post in one simulation (CLAUDE.md §66.3).
 *
 * Unknown ids fall back to a placeholder rather than throwing — a deleted
 * character must not break an existing timeline.
 */
export function toAuthorDto(
  authorId: string,
  charactersById: Map<string, Character>,
  usersById: Map<string, UserProfile>,
): PostAuthorDto {
  const user = usersById.get(authorId);
  if (user) {
    return {
      id: user.id,
      kind: "user",
      handle: user.handle,
      displayName: user.displayName,
      ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
    };
  }

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
  usersById: Map<string, UserProfile>,
): QuotedPostDto {
  return {
    id: post.id,
    author: toAuthorDto(post.authorId, charactersById, usersById),
    content: post.content,
    ...(post.imageUrl ? { imageUrl: post.imageUrl } : {}),
    createdAt: post.createdAt.toISOString(),
  };
}

export function toPostDto(
  post: Post,
  charactersById: Map<string, Character>,
  quotedPost: Post | null,
  usersById: Map<string, UserProfile>,
): PostDto {
  return {
    id: post.id,
    simulationId: post.simulationId,
    authorId: post.authorId,
    author: toAuthorDto(post.authorId, charactersById, usersById),
    content: post.content,
    ...(post.imageUrl ? { imageUrl: post.imageUrl } : {}),
    mentions: post.mentions,
    replyTo: post.replyTo,
    quoteOf: post.quoteOf,
    quotedPost: quotedPost
      ? toQuotedPostDto(quotedPost, charactersById, usersById)
      : null,
    createdAt: post.createdAt.toISOString(),
  };
}

/** Maps a batch of posts, resolving `quoteOf` against the same batch first. */
export function toPostDtos(
  posts: Post[],
  charactersById: Map<string, Character>,
  usersById: Map<string, UserProfile>,
  extraQuoted: Post[] = [],
): PostDto[] {
  const byId = new Map<string, Post>();
  for (const post of [...posts, ...extraQuoted]) byId.set(post.id, post);

  return posts.map((post) =>
    toPostDto(
      post,
      charactersById,
      post.quoteOf ? (byId.get(post.quoteOf) ?? null) : null,
      usersById,
    ),
  );
}

export function indexUsersById(users: UserProfile[]): Map<string, UserProfile> {
  return new Map(users.map((user) => [user.id, user]));
}
