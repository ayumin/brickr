import type { PostDto } from "@brickr/shared";
import type { CharacterRepository } from "../characters/character-repository.js";
import type { Character } from "../characters/character.js";
import type { UserProfileRepository } from "../user-profile/user-profile-repository.js";
import type { UserProfile } from "../user-profile/user-profile.js";
import { resolveKnownMentions } from "./mention-parser.js";
import { indexUsersById, toPostDto, toPostDtos } from "./post-mapper.js";
import type { NewPost, Post } from "./post.js";
import type { PostRepository } from "./post-repository.js";

export type PublishInput = {
  simulationId: string;
  authorId: string;
  content: string;
  imageUrl?: string;
  replyTo?: string | null;
  quoteOf?: string | null;
};

/**
 * Creating and reading posts, including mention extraction and DTO mapping.
 * Every post — user, character, reply, quote — goes through `publish`.
 */
export class PostService {
  constructor(
    private readonly posts: PostRepository,
    private readonly characters: CharacterRepository,
    private readonly userProfiles: UserProfileRepository,
  ) {}

  async publish(input: PublishInput): Promise<Post> {
    // Both halves of the shared handle namespace can be mentioned, so a post
    // naming another user resolves the same way as one naming a character.
    const [known, userHandles] = await Promise.all([
      this.characters.findAll(),
      this.userProfiles.listHandles(),
    ]);
    const mentions = resolveKnownMentions(
      input.content,
      [...userHandles, ...known.map((character) => character.handle)],
    );

    const newPost: NewPost = {
      simulationId: input.simulationId,
      authorId: input.authorId,
      content: input.content,
      ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
      mentions,
      replyTo: input.replyTo ?? null,
      quoteOf: input.quoteOf ?? null,
    };

    return this.posts.create(newPost);
  }

  async findById(id: string): Promise<Post | null> {
    return this.posts.findById(id);
  }

  async listBySimulation(simulationId: string): Promise<PostDto[]> {
    const posts = await this.posts.findBySimulation(simulationId);
    // Only the authors present in this page are loaded, rather than every
    // account in the database.
    const [characters, users] = await Promise.all([
      this.characters.findAllIncludingDeleted(),
      this.userProfiles.findByIds(posts.map((post) => post.authorId)),
    ]);
    return toPostDtos(posts, indexById(characters), indexUsersById(users));
  }

  /** Maps one post, loading its quoted post if it has one. */
  async toDto(post: Post): Promise<PostDto> {
    const [characters, quoted] = await Promise.all([
      this.characters.findAllIncludingDeleted(),
      post.quoteOf ? this.posts.findById(post.quoteOf) : Promise.resolve(null),
    ]);
    const users = await this.userProfiles.findByIds([
      post.authorId,
      ...(quoted ? [quoted.authorId] : []),
    ]);
    return toPostDto(post, indexById(characters), quoted, indexUsersById(users));
  }

  /** Author handles for a thread, used to render the LLM transcript (§66.3). */
  async findUsersByIds(ids: string[]): Promise<UserProfile[]> {
    return this.userProfiles.findByIds(ids);
  }
}

export function indexById(characters: Character[]): Map<string, Character> {
  return new Map(characters.map((character) => [character.id, character]));
}
