import { USER_AUTHOR_ID, USER_HANDLE } from "@brickr/shared";
import { describe, expect, it } from "vitest";
import type { UserProfileRepository } from "./user-profile-repository.js";
import { UserProfileService } from "./user-profile-service.js";
import type { SaveUserProfile, UserProfile } from "./user-profile.js";

function makeService(initial: UserProfile) {
  let profile = initial;
  const repository = {
    get: (): Promise<UserProfile> => Promise.resolve(profile),
    update: (input: SaveUserProfile): Promise<UserProfile> => {
      profile = { id: USER_AUTHOR_ID, ...input };
      return Promise.resolve(profile);
    },
  } as unknown as UserProfileRepository;
  return new UserProfileService(repository);
}

describe("UserProfileService", () => {
  it("returns the fixed user id and handle with editable profile fields", async () => {
    const service = makeService({
      id: USER_AUTHOR_ID,
      displayName: "テストユーザー",
      description: "自己紹介",
      avatarUrl: "https://example.com/avatar.png",
    });

    await expect(service.get()).resolves.toEqual({
      id: USER_AUTHOR_ID,
      handle: USER_HANDLE,
      displayName: "テストユーザー",
      description: "自己紹介",
      avatarUrl: "https://example.com/avatar.png",
    });
  });

  it("updates display name, description and avatar", async () => {
    const service = makeService({
      id: USER_AUTHOR_ID,
      displayName: "あなた",
      description: "",
    });

    const updated = await service.update({
      displayName: "変更後",
      description: "変更後のプロフィール",
      avatarUrl: "https://example.com/new.png",
    });

    expect(updated).toMatchObject({
      handle: USER_HANDLE,
      displayName: "変更後",
      description: "変更後のプロフィール",
      avatarUrl: "https://example.com/new.png",
    });
  });
});
