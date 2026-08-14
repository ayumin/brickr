import { describe, expect, it } from "vitest";
import type { CharacterRepository } from "../characters/character-repository.js";
import type { UserProfileRepository } from "../user-profile/user-profile-repository.js";
import type { PostRepository } from "./post-repository.js";
import { PostService } from "./post-service.js";
import type { NewPost, Post } from "./post.js";

const AUTHOR_ID = "11111111-1111-4111-8111-111111111111";
const USER_HANDLE = "hanako";

function makePost(overrides: Partial<Post> & { id: string }): Post {
  return {
    simulationId: "sim-1",
    authorId: AUTHOR_ID,
    content: "content",
    mentions: [],
    replyTo: null,
    quoteOf: null,
    threadRootId: overrides.id,
    threadActivityAt: new Date("2026-08-10T00:00:00Z"),
    createdAt: new Date("2026-08-10T00:00:00Z"),
    ...overrides,
  };
}

/**
 * Records what the service asked to persist, and serves the posts it looks up.
 *
 * The thread root is resolved by the repository inside its write transaction
 * (§8.4), so this stand-in derives it the same way the real one does.
 */
function harness(existing: Post[] = []) {
  const byId = new Map(existing.map((post) => [post.id, post]));
  const created: NewPost[] = [];

  const posts = {
    createWithThreadActivity(input: NewPost): Promise<Post> {
      created.push(input);
      const parent = input.replyTo ? byId.get(input.replyTo) : undefined;
      return Promise.resolve({
        ...input,
        replyTo: input.replyTo ?? null,
        quoteOf: input.quoteOf ?? null,
        threadRootId: parent?.threadRootId ?? input.id,
        threadActivityAt: new Date("2026-08-11T00:00:00Z"),
        createdAt: new Date("2026-08-11T00:00:00Z"),
      });
    },
    findById(id: string): Promise<Post | null> {
      return Promise.resolve(byId.get(id) ?? null);
    },
  } as unknown as PostRepository;

  const characters = {
    findAll: () =>
      Promise.resolve([
        {
          id: "architect-id",
          handle: "architect",
          displayName: "設計者",
          description: "設計する",
          rolePrompt: "設計",
          tonePrompt: "简潔",
          interests: [],
          activityLevel: 0.5,
          responseProbability: 0.5,
          replyProbability: 0.5,
          quoteProbability: 0.5,
          influence: 0.5,
          modelProfileId: "test",
        },
      ]),
  } as unknown as CharacterRepository;

  const profiles = {
    listHandles: () => Promise.resolve([USER_HANDLE]),
  } as unknown as UserProfileRepository;

  return { service: new PostService(posts, characters, profiles), created };
}

describe("PostService.publish mentions", () => {
  it("persists mentions of both a user and known characters", async () => {
    const { service, created } = harness();

    await service.publish({
      simulationId: "sim-1",
      authorId: AUTHOR_ID,
      content: `@${USER_HANDLE} と @architect に共有`,
    });

    expect(created[0]?.mentions).toEqual([USER_HANDLE, "architect"]);
  });
});

/**
 * What the service owns is the id and the reply/quote intent it hands over. The
 * root itself is derived in the write transaction, and is fixed by
 * `post-repository.test.ts` (§8.3, §8.4).
 */
describe("PostService.publish thread information (§8.3)", () => {
  it("mints the post id before the insert, so a new thread can be its own root", async () => {
    const { service, created } = harness();

    const post = await service.publish({
      simulationId: "sim-1",
      authorId: AUTHOR_ID,
      content: "新しい話題",
    });

    expect(created[0]?.id).toBe(post.id);
    expect(post.threadRootId).toBe(post.id);
    expect(post.replyTo).toBeNull();
  });

  it("passes the reply target on instead of resolving its root itself", async () => {
    const root = makePost({ id: "root-1" });
    const { service, created } = harness([root]);

    const reply = await service.publish({
      simulationId: "sim-1",
      authorId: AUTHOR_ID,
      content: "返信",
      replyTo: root.id,
    });

    expect(created[0]?.replyTo).toBe("root-1");
    expect(created[0]).not.toHaveProperty("threadRootId");
    expect(reply.threadRootId).toBe("root-1");
  });

  it("keeps a quote repost a top-level post rather than a reply", async () => {
    const quoted = makePost({ id: "root-1" });
    const { service, created } = harness([quoted]);

    const post = await service.publish({
      simulationId: "sim-1",
      authorId: AUTHOR_ID,
      content: "引用して意見",
      quoteOf: quoted.id,
    });

    expect(post.threadRootId).toBe(post.id);
    expect(created[0]?.quoteOf).toBe("root-1");
    expect(created[0]?.replyTo).toBeNull();
  });
});
