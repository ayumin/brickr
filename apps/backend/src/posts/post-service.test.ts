import { USER_AUTHOR_ID, USER_HANDLE } from "@enjo/shared";
import { describe, expect, it } from "vitest";
import type { CharacterRepository } from "../characters/character-repository.js";
import type { UserProfileRepository } from "../user-profile/user-profile-repository.js";
import type { PostRepository } from "./post-repository.js";
import { PostService } from "./post-service.js";
import type { NewPost, Post } from "./post.js";

describe("PostService.publish mentions", () => {
  it("persists mentions of both the user and known characters", async () => {
    let created: NewPost | undefined;
    const posts = {
      create(input: NewPost): Promise<Post> {
        created = input;
        return Promise.resolve({
          id: "post-1",
          createdAt: new Date("2026-08-10T00:00:00Z"),
          ...input,
          replyTo: input.replyTo ?? null,
          quoteOf: input.quoteOf ?? null,
        });
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
            tonePrompt: "簡潔",
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
    const profiles = {} as UserProfileRepository;

    await new PostService(posts, characters, profiles).publish({
      simulationId: "sim-1",
      authorId: USER_AUTHOR_ID,
      content: `@${USER_HANDLE} と @architect に共有`,
    });

    expect(created?.mentions).toEqual([USER_HANDLE, "architect"]);
  });
});
