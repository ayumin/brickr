import { describe, expect, it } from "vitest";
import type { CharacterRepository } from "../characters/character-repository.js";
import type { Character } from "../characters/character.js";
import { encodeFeedCursor } from "../feed/feed-cursor.js";
import type { HandleRepository } from "../handles/handle-repository.js";
import type { PostService } from "../posts/post-service.js";
import type { Post } from "../posts/post.js";
import type { UserProfileRepository } from "../user-profile/user-profile-repository.js";
import { PROFILE_PAGE_SIZE, ProfileNotFoundError, ProfileService } from "./profile-service.js";
import type { ProfileRepository } from "./profile-repository.js";

/**
 * The profile service exists to make a person and an AI cast member
 * indistinguishable (§9.2, §21): one route, one resolution path, one DTO. These
 * tests are mostly about what is *absent* from its answer.
 */
const VIEWER = { id: "user-1", isAdmin: false };
const ADMIN = { id: "admin-1", isAdmin: true };
const CAST_OWNER = { id: "user-2", isAdmin: false };

const CAST: Character = {
  id: "cast-1",
  handle: "kansai",
  displayName: "ナニワ",
  description: "大阪の人",
  rolePrompt: "role",
  tonePrompt: "tone",
  interests: ["漫才"],
  activityLevel: 0.5,
  responseProbability: 0.5,
  replyProbability: 0.5,
  quoteProbability: 0.5,
  influence: 0.5,
  modelProfileId: "anthropic-default",
  createdByUserId: CAST_OWNER.id,
  avatarUrl: "data:image/png;base64,AAA",
};

const PERSON = {
  id: "user-1",
  handle: "hanako",
  displayName: "花子",
  description: "人間です",
};

function post(id: string, createdAt: Date): Post {
  return {
    id,
    simulationId: "room-1",
    authorId: CAST.id,
    content: id,
    mentions: [],
    replyTo: null,
    quoteOf: null,
    threadRootId: id,
    threadActivityAt: createdAt,
    createdAt,
  };
}

function makeService(options: { character?: Character | null; posts?: Post[] } = {}) {
  const character = options.character === undefined ? CAST : options.character;
  const posts = options.posts ?? [];

  const handles = {
    findByHandle: (handle: string) =>
      Promise.resolve(
        handle === CAST.handle
          ? { handle, ownerType: "character" as const, ownerId: CAST.id }
          : handle === PERSON.handle
            ? { handle, ownerType: "user" as const, ownerId: PERSON.id }
            : null,
      ),
  } as unknown as HandleRepository;

  const characters = {
    findByIdIncludingDeleted: () => Promise.resolve(character),
  } as unknown as CharacterRepository;

  const users = {
    findById: (id: string) => Promise.resolve(id === PERSON.id ? PERSON : null),
  } as unknown as UserProfileRepository;

  const profiles = {
    findPostsByAuthor: (input: { limit: number }) => Promise.resolve(posts.slice(0, input.limit)),
    countPostsByAuthor: () => Promise.resolve(posts.length),
  } as unknown as ProfileRepository;

  const postService = {
    toDtos: (list: Post[]) => Promise.resolve(list.map((p) => ({ id: p.id }))),
  } as unknown as PostService;

  return new ProfileService(handles, characters, users, profiles, postService);
}

describe("ProfileService.getProfile", () => {
  it("describes a cast member with the same fields as a person, and nothing more", async () => {
    const service = makeService();

    const cast = await service.getProfile(CAST.handle, VIEWER);
    const person = await service.getProfile(PERSON.handle, VIEWER);

    expect(Object.keys(cast).sort()).toEqual(
      ["avatarUrl", "canEdit", "description", "displayName", "handle", "id", "postCount"].sort(),
    );
    // The person has no avatar in this fixture, so only the optional field differs.
    expect(Object.keys(person).sort()).toEqual(
      ["canEdit", "description", "displayName", "handle", "id", "postCount"].sort(),
    );
  });

  it("never carries the persona, the model or the owner", async () => {
    const service = makeService();

    const profile = await service.getProfile(CAST.handle, ADMIN);

    for (const forbidden of [
      "ownerType",
      "rolePrompt",
      "tonePrompt",
      "interests",
      "modelProfileId",
      "createdByUserId",
      "activityLevel",
      "responseProbability",
    ]) {
      expect(profile).not.toHaveProperty(forbidden);
    }
  });

  it("grants canEdit to the cast member's creator and to an admin, to nobody else", async () => {
    const service = makeService();

    await expect(service.getProfile(CAST.handle, CAST_OWNER)).resolves.toMatchObject({
      canEdit: true,
    });
    await expect(service.getProfile(CAST.handle, ADMIN)).resolves.toMatchObject({ canEdit: true });
    await expect(service.getProfile(CAST.handle, VIEWER)).resolves.toMatchObject({
      canEdit: false,
    });
  });

  it("grants canEdit on your own profile, which is why canEdit reveals no kind of account", async () => {
    const service = makeService();

    // If `canEdit: true` only ever meant "this is a character", it would be the
    // discriminator this DTO exists to remove (§9.2).
    await expect(service.getProfile(PERSON.handle, VIEWER)).resolves.toMatchObject({
      canEdit: true,
    });
    await expect(service.getProfile(PERSON.handle, ADMIN)).resolves.toMatchObject({
      canEdit: false,
    });
  });

  it("still opens a soft-deleted cast member's profile, but never for editing", async () => {
    const service = makeService({
      character: { ...CAST, deletedAt: new Date("2026-01-01T00:00:00Z") },
    });

    // Past posts still name them as the author, so the profile has to open (§10.6);
    // restoring one happens from the management list, not from here.
    await expect(service.getProfile(CAST.handle, CAST_OWNER)).resolves.toMatchObject({
      id: CAST.id,
      canEdit: false,
    });
  });

  it("answers the same error for an unknown handle whichever half of the namespace it is", async () => {
    const service = makeService();

    await expect(service.getProfile("nobody_here", VIEWER)).rejects.toBeInstanceOf(
      ProfileNotFoundError,
    );
  });

  it("treats a handle whose character row is gone as no profile at all", async () => {
    const service = makeService({ character: null });

    await expect(service.getProfile(CAST.handle, VIEWER)).rejects.toBeInstanceOf(
      ProfileNotFoundError,
    );
  });
});

describe("ProfileService.listPosts", () => {
  it("issues a next cursor only when a further page exists", async () => {
    const base = new Date("2026-08-13T10:00:00.000Z");
    const full = Array.from({ length: PROFILE_PAGE_SIZE + 1 }, (_, index) =>
      post(`post-${String(index)}`, new Date(base.getTime() - index * 1000)),
    );

    const withMore = await makeService({ posts: full }).listPosts(CAST.handle, VIEWER);
    const exact = await makeService({ posts: full.slice(0, PROFILE_PAGE_SIZE) }).listPosts(
      CAST.handle,
      VIEWER,
    );

    expect(withMore.posts).toHaveLength(PROFILE_PAGE_SIZE);
    const last = full[PROFILE_PAGE_SIZE - 1]!;
    expect(withMore.nextCursor).toBe(
      encodeFeedCursor({ activityAt: last.createdAt, id: last.id }),
    );
    expect(exact.posts).toHaveLength(PROFILE_PAGE_SIZE);
    expect(exact.nextCursor).toBeNull();
  });

  it("refuses an unknown handle before reading any posts", async () => {
    await expect(makeService().listPosts("nobody_here", VIEWER)).rejects.toBeInstanceOf(
      ProfileNotFoundError,
    );
  });
});
