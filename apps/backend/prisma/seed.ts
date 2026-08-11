import { CHARACTER_SEEDS } from "../src/characters/character-seeds.js";
import { MODEL_PROFILE_SEEDS } from "../src/model-profiles/model-profile-seeds.js";
import { prisma } from "../src/persistence/prisma.js";
import { USER_AUTHOR_ID, USER_DISPLAY_NAME, USER_HANDLE } from "@brickr/shared";
import { demoAvatarDataUrl } from "../src/characters/demo-avatar.js";
import { bootstrapAdmin, describeAdminBootstrap } from "../src/auth/admin-bootstrap.js";
import { UserAccountRepository } from "../src/auth/user-account-repository.js";
import { env } from "../src/config/env.js";

/**
 * Idempotent seed: model profiles first, then characters.
 *
 * Runs on every container start, so it upserts rather than inserts.
 */
async function main(): Promise<void> {
  await prisma.userProfile.upsert({
    where: { id: USER_AUTHOR_ID },
    create: {
      id: USER_AUTHOR_ID,
      displayName: USER_DISPLAY_NAME,
      description: "",
      handle: USER_HANDLE,
    },
    // Backfills the handle of the pre-login singleton without touching the
    // profile fields the user may already have edited.
    update: { handle: USER_HANDLE },
  });
  await claimHandle(USER_HANDLE, "user", USER_AUTHOR_ID);

  for (const profile of MODEL_PROFILE_SEEDS) {
    await prisma.modelProfile.upsert({
      where: { id: profile.id },
      create: { id: profile.id, providerId: profile.providerId, model: profile.model },
      update: { providerId: profile.providerId, model: profile.model },
    });
  }
  console.log(`seeded ${MODEL_PROFILE_SEEDS.length} model profiles`);

  for (const [index, seed] of CHARACTER_SEEDS.entries()) {
    const data = {
      handle: seed.handle,
      displayName: seed.displayName,
      description: seed.description,
      rolePrompt: seed.rolePrompt,
      tonePrompt: seed.tonePrompt,
      dialectPrompt: seed.dialectPrompt ?? null,
      interests: seed.interests,
      activityLevel: seed.activityLevel ?? 0.5,
      responseProbability: seed.responseProbability ?? 0.5,
      replyProbability: seed.replyProbability ?? 0.6,
      quoteProbability: seed.quoteProbability ?? 0.2,
      influence: seed.influence ?? 0.5,
      modelProfileId: seed.modelProfileId,
      avatarUrl: seed.avatarUrl ?? demoAvatarDataUrl(index),
    };

    await prisma.character.upsert({
      where: { id: seed.id },
      create: { id: seed.id, ...data },
      update: data,
    });
  }
  console.log(`seeded ${CHARACTER_SEEDS.length} characters`);

  // Characters own their handles in the shared namespace too (§66.13).
  for (const seed of CHARACTER_SEEDS) {
    await claimHandle(seed.handle, "character", seed.id);
  }

  // Root of the invite chain (§66.9). Never logs ADMIN_PASSWORD.
  const outcome = await bootstrapAdmin(new UserAccountRepository(prisma), {
    email: env.admin.email,
    password: env.admin.password,
    handle: env.admin.handle,
    displayName: env.admin.displayName,
  });
  console.log(describeAdminBootstrap(outcome));
}

/**
 * Idempotent claim on the shared handle namespace. Re-pointing an existing row
 * keeps the seed rerunnable after a character id changes.
 */
async function claimHandle(
  handle: string,
  ownerType: "user" | "character",
  ownerId: string,
): Promise<void> {
  await prisma.handleOwner.upsert({
    where: { handle },
    create: { handle, ownerType, ownerId },
    update: { ownerType, ownerId },
  });
}

main()
  .catch((error: unknown) => {
    console.error("seed failed", error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
