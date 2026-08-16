import { GLOBAL_SIMULATION_ID } from "@brickr/shared";
import { CHARACTER_SEEDS } from "../src/characters/character-seeds.js";
import { MODEL_PROFILE_SEEDS } from "../src/model-profiles/model-profile-seeds.js";
import { prisma, type DbTransaction } from "../src/persistence/prisma.js";
import { demoAvatarDataUrl } from "../src/characters/demo-avatar.js";
import { bootstrapAdmin, describeAdminBootstrap } from "../src/auth/admin-bootstrap.js";
import { UserAccountRepository } from "../src/auth/user-account-repository.js";
import { env } from "../src/config/env.js";

/**
 * The fixed UUID for the room that backs the unified feed (§8.2).
 *
 * Imported from @brickr/shared so the seed always uses the same value as the
 * rest of the application, preventing silent drift between the seeded row and
 * the id the unified feed actually queries.
 */
const FEED_ROOM_ID = GLOBAL_SIMULATION_ID;

/**
 * Fixed UUIDs for the demo rooms seeded for development.
 *
 * Hard-coded so re-running the seed updates rather than duplicates them.
 */
const DEMO_ROOM_IDS = {
  public: "10000000-0000-4000-8000-000000000001",
  open: "10000000-0000-4000-8000-000000000002",
  closed: "10000000-0000-4000-8000-000000000003",
  private: "10000000-0000-4000-8000-000000000004",
} as const;

/**
 * Idempotent seed: model profiles, characters, the feed room, and demo rooms
 * with memberships covering every visibility and membership-status combination.
 *
 * Runs on every container start, so it upserts rather than inserts.
 *
 * There is no pre-login account any more (§8.2): posting requires a session, so
 * every post author is a real signed-in account or a character.
 */
async function main(): Promise<void> {
  // --- Model profiles -------------------------------------------------------

  for (const profile of MODEL_PROFILE_SEEDS) {
    await prisma.modelProfile.upsert({
      where: { id: profile.id },
      create: { id: profile.id, providerId: profile.providerId, model: profile.model },
      update: { providerId: profile.providerId, model: profile.model },
    });
  }
  console.log(`seeded ${MODEL_PROFILE_SEEDS.length} model profiles`);

  // --- Characters -----------------------------------------------------------

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

  // --- Admin bootstrap ------------------------------------------------------

  // Root of the invite chain (§66.9). Never logs ADMIN_PASSWORD.
  const outcome = await bootstrapAdmin(new UserAccountRepository(prisma), {
    email: env.admin.email,
    password: env.admin.password,
    handle: env.admin.handle,
    displayName: env.admin.displayName,
  });
  console.log(describeAdminBootstrap(outcome));

  // --- Feed room (scope: "global") ------------------------------------------
  //
  // The one room that backs the unified feed. `update` deliberately restores
  // title and scope so a stray rename cannot leave the feed broken.
  // This room is never listed as an ordinary room (§8.2).

  await prisma.room.upsert({
    where: { id: FEED_ROOM_ID },
    create: {
      id: FEED_ROOM_ID,
      title: "フィード",
      status: "active",
      scope: "global",
      createdByUserId: null,
    },
    update: {
      title: "フィード",
      status: "active",
      scope: "global",
      createdByUserId: null,
    },
  });
  console.log("seeded the feed room");

  // --- Demo rooms (scope: "room") -------------------------------------------
  //
  // One room per visibility type so every code path can be exercised on a
  // fresh database. Memberships cover active / pending / left / removed /
  // banned statuses so the membership lifecycle is testable without manual setup.
  //
  // These rooms are owned by no user (createdByUserId: null) — demo rooms are
  // intentionally unowned so they don't appear as personal rooms of the admin.
  // Character memberships are seeded instead so the rooms are not completely empty.

  await seedDemoRooms();
}

/**
 * Seeds four demo rooms (one per visibility) and adds character memberships
 * that cover every MemberStatus value.
 *
 * Wrapped in a transaction so a partial failure leaves the DB clean.
 */
async function seedDemoRooms(): Promise<void> {
  // Pick a handful of characters to populate the demo rooms.
  // Using fixed indices keeps the seed deterministic.
  const chars = CHARACTER_SEEDS;
  if (chars.length < 4 || !chars[0] || !chars[1] || !chars[2]) {
    console.warn("not enough characters to seed demo room memberships — skipping");
    return;
  }

  const char0 = chars[0];
  const char1 = chars[1];
  const char2 = chars[2];

  await prisma.$transaction(async (tx: DbTransaction) => {
    // Public room — visible and joinable by anyone.
    await tx.room.upsert({
      where: { id: DEMO_ROOM_IDS.public },
      create: {
        id: DEMO_ROOM_IDS.public,
        title: "パブリックルーム",
        description: "誰でも参加できる公開ルームです。",
        status: "active",
        scope: "room",
        visibility: "public",
        tags: ["demo", "public"],
        createdByUserId: null,
      },
      update: {
        title: "パブリックルーム",
        description: "誰でも参加できる公開ルームです。",
        status: "active",
        visibility: "public",
        tags: ["demo", "public"],
      },
    });

    // Open room — visible to anyone; joining requires approval.
    await tx.room.upsert({
      where: { id: DEMO_ROOM_IDS.open },
      create: {
        id: DEMO_ROOM_IDS.open,
        title: "オープンルーム",
        description: "誰でも閲覧できますが、参加には承認が必要です。",
        status: "active",
        scope: "room",
        visibility: "open",
        tags: ["demo", "open"],
        createdByUserId: null,
      },
      update: {
        title: "オープンルーム",
        description: "誰でも閲覧できますが、参加には承認が必要です。",
        status: "active",
        visibility: "open",
        tags: ["demo", "open"],
      },
    });

    // Closed room — visible to members only; joining requires an invitation.
    await tx.room.upsert({
      where: { id: DEMO_ROOM_IDS.closed },
      create: {
        id: DEMO_ROOM_IDS.closed,
        title: "クローズドルーム",
        description: "メンバーのみ閲覧可能で、招待制のルームです。",
        status: "active",
        scope: "room",
        visibility: "closed",
        tags: ["demo", "closed"],
        createdByUserId: null,
      },
      update: {
        title: "クローズドルーム",
        description: "メンバーのみ閲覧可能で、招待制のルームです。",
        status: "active",
        visibility: "closed",
        tags: ["demo", "closed"],
      },
    });

    // Private room — invisible and invite-only.
    await tx.room.upsert({
      where: { id: DEMO_ROOM_IDS.private },
      create: {
        id: DEMO_ROOM_IDS.private,
        title: "プライベートルーム",
        description: "招待された人だけが参加できる非公開ルームです。",
        status: "active",
        scope: "room",
        visibility: "private",
        tags: ["demo", "private"],
        createdByUserId: null,
      },
      update: {
        title: "プライベートルーム",
        description: "招待された人だけが参加できる非公開ルームです。",
        status: "active",
        visibility: "private",
        tags: ["demo", "private"],
      },
    });

    console.log("seeded 4 demo rooms (public / open / closed / private)");

    // --- Character memberships -----------------------------------------------
    //
    // Seed memberships that cover every MemberStatus so the lifecycle is
    // testable without manual setup. Characters are always "member" role (§145).

    // Public room: two active members, one pending.
    await upsertMembership(tx, DEMO_ROOM_IDS.public, char0.id, "active");
    await upsertMembership(tx, DEMO_ROOM_IDS.public, char1.id, "active");
    await upsertMembership(tx, DEMO_ROOM_IDS.public, char2.id, "pending");

    // Open room: one active member, one pending (awaiting approval), one banned.
    await upsertMembership(tx, DEMO_ROOM_IDS.open, char0.id, "active");
    await upsertMembership(tx, DEMO_ROOM_IDS.open, char1.id, "pending");
    await upsertMembership(tx, DEMO_ROOM_IDS.open, char2.id, "banned");

    // Closed room: two active members, one who left.
    await upsertMembership(tx, DEMO_ROOM_IDS.closed, char0.id, "active");
    await upsertMembership(tx, DEMO_ROOM_IDS.closed, char1.id, "active");
    await upsertMembership(tx, DEMO_ROOM_IDS.closed, char2.id, "left");

    // Private room: one active member, one removed.
    await upsertMembership(tx, DEMO_ROOM_IDS.private, char0.id, "active");
    await upsertMembership(tx, DEMO_ROOM_IDS.private, char1.id, "removed");

    console.log("seeded demo room memberships");
  });
}

/**
 * Idempotent character membership upsert.
 *
 * Uses the unique index (roomId, memberKind, memberId) as the lookup key so
 * re-running the seed updates the status rather than inserting a duplicate.
 */
async function upsertMembership(
  tx: DbTransaction,
  roomId: string,
  characterId: string,
  status: "active" | "pending" | "left" | "removed" | "banned",
): Promise<void> {
  await tx.roomMembership.upsert({
    where: {
      roomId_memberKind_memberId: {
        roomId,
        memberKind: "character",
        memberId: characterId,
      },
    },
    create: {
      roomId,
      memberKind: "character",
      memberId: characterId,
      role: "member",
      status,
    },
    update: { status },
  });
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
