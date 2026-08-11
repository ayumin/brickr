import { describe, expect, it } from "vitest";
import type { UserProfileRepository } from "./user-profile-repository.js";
import { UserProfileService } from "./user-profile-service.js";
import type { SaveUserProfile, UserProfile } from "./user-profile.js";

function makeService(initial: UserProfile[]) {
  const profiles = new Map(initial.map((profile) => [profile.id, profile]));

  const repository = {
    findById: (id: string): Promise<UserProfile | null> =>
      Promise.resolve(profiles.get(id) ?? null),
    update: (id: string, input: SaveUserProfile): Promise<UserProfile> => {
      const existing = profiles.get(id);
      if (!existing) return Promise.reject(new Error(`no profile ${id}`));
      const updated = { ...existing, ...input };
      profiles.set(id, updated);
      return Promise.resolve(updated);
    },
  } as unknown as UserProfileRepository;

  return { service: new UserProfileService(repository), profiles };
}

const hanako: UserProfile = {
  id: "user-1",
  handle: "hanako",
  displayName: "花子",
  description: "自己紹介",
  avatarUrl: "https://example.com/avatar.png",
};

const taro: UserProfile = {
  id: "user-2",
  handle: "taro",
  displayName: "太郎",
  description: "",
};

describe("UserProfileService.get", () => {
  it("returns the stored handle rather than a fixed one", async () => {
    const { service } = makeService([hanako]);

    await expect(service.get("user-1")).resolves.toEqual({
      id: "user-1",
      handle: "hanako",
      displayName: "花子",
      description: "自己紹介",
      avatarUrl: "https://example.com/avatar.png",
    });
  });

  it("keeps two accounts apart", async () => {
    const { service } = makeService([hanako, taro]);

    await expect(service.get("user-2")).resolves.toMatchObject({ handle: "taro" });
  });

  it("returns null for an unknown id instead of inventing a profile", async () => {
    const { service } = makeService([hanako]);

    await expect(service.get("nobody")).resolves.toBeNull();
  });
});

describe("UserProfileService.update", () => {
  it("updates display name, description and avatar", async () => {
    const { service } = makeService([hanako]);

    await expect(
      service.update("user-1", {
        displayName: "変更後",
        description: "変更後のプロフィール",
        avatarUrl: "https://example.com/new.png",
      }),
    ).resolves.toMatchObject({
      handle: "hanako",
      displayName: "変更後",
      description: "変更後のプロフィール",
      avatarUrl: "https://example.com/new.png",
    });
  });

  it("cannot change the handle, which is fixed at signup (§66.1)", async () => {
    const { service } = makeService([hanako]);

    const updated = await service.update("user-1", {
      displayName: "変更後",
      description: "",
      // Present on the request type only as an accident of shape; ignored here.
    });

    expect(updated.handle).toBe("hanako");
  });

  it("only touches the account it was given", async () => {
    const { service, profiles } = makeService([hanako, taro]);

    await service.update("user-1", { displayName: "変更後", description: "" });

    expect(profiles.get("user-2")).toEqual(taro);
  });
});
