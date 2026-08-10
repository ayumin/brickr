import { USER_AUTHOR_ID, USER_DISPLAY_NAME } from "@brickr/shared";
import type { Db } from "../persistence/prisma.js";
import type { SaveUserProfile, UserProfile } from "./user-profile.js";

type UserProfileRow = {
  id: string;
  displayName: string;
  description: string;
  avatarUrl: string | null;
};

function toUserProfile(row: UserProfileRow): UserProfile {
  return {
    id: row.id,
    displayName: row.displayName,
    description: row.description,
    ...(row.avatarUrl ? { avatarUrl: row.avatarUrl } : {}),
  };
}

export class UserProfileRepository {
  constructor(private readonly db: Db) {}

  async get(): Promise<UserProfile> {
    const row = await this.db.userProfile.upsert({
      where: { id: USER_AUTHOR_ID },
      create: {
        id: USER_AUTHOR_ID,
        displayName: USER_DISPLAY_NAME,
        description: "",
      },
      update: {},
    });
    return toUserProfile(row);
  }

  async update(input: SaveUserProfile): Promise<UserProfile> {
    const row = await this.db.userProfile.upsert({
      where: { id: USER_AUTHOR_ID },
      create: { id: USER_AUTHOR_ID, ...toWriteData(input) },
      update: toWriteData(input),
    });
    return toUserProfile(row);
  }
}

function toWriteData(input: SaveUserProfile) {
  return {
    displayName: input.displayName,
    description: input.description,
    avatarUrl: input.avatarUrl ?? null,
  };
}
