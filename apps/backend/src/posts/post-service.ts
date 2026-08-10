import { USER_HANDLE, type PostDto } from "@enjo/shared";
import type { CharacterRepository } from "../characters/character-repository.js";
import type { Character } from "../characters/character.js";
import type { UserProfileRepository } from "../user-profile/user-profile-repository.js";
import { resolveKnownMentions } from "./mention-parser.js";
import { toPostDto, toPostDtos } from "./post-mapper.js";
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
    const known = await this.characters.findAll();
    const mentions = resolveKnownMentions(
      input.content,
      [USER_HANDLE, ...known.map((character) => character.handle)],
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
    const [posts, characters, userProfile] = await Promise.all([
      this.posts.findBySimulation(simulationId),
      this.characters.findAllIncludingDeleted(),
      this.userProfiles.get(),
    ]);
    return toPostDtos(posts, indexById(characters), userProfile);
  }

  /** Maps one post, loading its quoted post if it has one. */
  async toDto(post: Post): Promise<PostDto> {
    const [characters, quoted, userProfile] = await Promise.all([
      this.characters.findAllIncludingDeleted(),
      post.quoteOf ? this.posts.findById(post.quoteOf) : Promise.resolve(null),
      this.userProfiles.get(),
    ]);
    return toPostDto(post, indexById(characters), quoted, userProfile);
  }
}

export function indexById(characters: Character[]): Map<string, Character> {
  return new Map(characters.map((character) => [character.id, character]));
}
