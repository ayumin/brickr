-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MemberKind" AS ENUM ('user', 'character');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('owner', 'member');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('active', 'pending', 'left', 'removed', 'banned');

-- CreateEnum
CREATE TYPE "RoomVisibility" AS ENUM ('public', 'open', 'closed', 'private');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "SnapshotStatus" AS ENUM ('pending', 'completed', 'failed');

-- CreateTable
CREATE TABLE "model_profiles" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "characters" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "role_prompt" TEXT NOT NULL,
    "tone_prompt" TEXT NOT NULL,
    "dialect_prompt" TEXT,
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "activity_level" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "response_probability" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "reply_probability" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "quote_probability" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "influence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "behavior_profile_key" TEXT,
    "cast_autonomous" BOOLEAN NOT NULL DEFAULT true,
    "model_profile_id" TEXT NOT NULL,
    "avatar_url" TEXT,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "characters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "description" TEXT,
    "visibility" "RoomVisibility" NOT NULL DEFAULT 'public',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "theme" TEXT,
    "cast_autonomous" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "image_url" TEXT,
    "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reply_to" TEXT,
    "quote_of" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "thread_root_id" TEXT NOT NULL,
    "thread_activity_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "avatar_url" TEXT,
    "handle" TEXT,
    "email" TEXT,
    "password_hash" TEXT,
    "birthdate" DATE,
    "country" TEXT,
    "region" TEXT,
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "occupation" TEXT,
    "x_handle" TEXT,
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "token_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("token_hash")
);

-- CreateTable
CREATE TABLE "handles" (
    "handle" TEXT NOT NULL,
    "owner_type" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "handles_pkey" PRIMARY KEY ("handle")
);

-- CreateTable
CREATE TABLE "invite_codes" (
    "code" TEXT NOT NULL,
    "issued_by_id" TEXT NOT NULL,
    "used_by_id" TEXT,
    "used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_codes_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "application_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "room_memberships" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "member_kind" "MemberKind" NOT NULL,
    "member_id" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'member',
    "status" "MemberStatus" NOT NULL DEFAULT 'pending',
    "invited_by_id" TEXT,
    "invited_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'pending',
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "room_id" TEXT,
    "post_id" TEXT,
    "thread_root_id" TEXT,
    "character_id" TEXT,
    "locked_by" TEXT,
    "locked_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_usages" (
    "user_id" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "token_usages_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "room_analysis_snapshots" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "post_count" INTEGER NOT NULL,
    "latest_post_id" TEXT,
    "summary" TEXT,
    "status" "SnapshotStatus" NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_analysis_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_budgets" (
    "provider" TEXT NOT NULL,
    "token_limit" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "stopped" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "llm_budgets_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "llm_usages" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "total_tokens" INTEGER NOT NULL,
    "room_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "characters_handle_idx" ON "characters"("handle");

-- CreateIndex
CREATE INDEX "characters_created_by_user_id_idx" ON "characters"("created_by_user_id");

-- CreateIndex
CREATE INDEX "rooms_created_by_user_id_idx" ON "rooms"("created_by_user_id");

-- CreateIndex
CREATE INDEX "rooms_status_last_activity_at_idx" ON "rooms"("status", "last_activity_at");

-- CreateIndex
CREATE INDEX "rooms_created_by_user_id_status_last_activity_at_idx" ON "rooms"("created_by_user_id", "status", "last_activity_at");

-- CreateIndex
CREATE INDEX "posts_room_id_created_at_idx" ON "posts"("room_id", "created_at");

-- CreateIndex
CREATE INDEX "posts_reply_to_idx" ON "posts"("reply_to");

-- CreateIndex
CREATE INDEX "posts_quote_of_idx" ON "posts"("quote_of");

-- CreateIndex
CREATE INDEX "posts_reply_to_thread_activity_at_id_idx" ON "posts"("reply_to", "thread_activity_at", "id");

-- CreateIndex
CREATE INDEX "posts_room_id_reply_to_thread_activity_at_id_idx" ON "posts"("room_id", "reply_to", "thread_activity_at", "id");

-- CreateIndex
CREATE INDEX "posts_thread_root_id_created_at_id_idx" ON "posts"("thread_root_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_email_key" ON "user_profiles"("email");

-- CreateIndex
CREATE INDEX "user_profiles_handle_idx" ON "user_profiles"("handle");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "handles_owner_type_owner_id_key" ON "handles"("owner_type", "owner_id");

-- CreateIndex
CREATE INDEX "invite_codes_issued_by_id_idx" ON "invite_codes"("issued_by_id");

-- CreateIndex
CREATE INDEX "room_memberships_room_id_status_idx" ON "room_memberships"("room_id", "status");

-- CreateIndex
CREATE INDEX "room_memberships_member_id_member_kind_idx" ON "room_memberships"("member_id", "member_kind");

-- CreateIndex
CREATE UNIQUE INDEX "room_memberships_room_id_member_kind_member_id_key" ON "room_memberships"("room_id", "member_kind", "member_id");

-- CreateIndex
CREATE INDEX "scheduled_events_status_scheduled_at_idx" ON "scheduled_events"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "scheduled_events_status_locked_at_idx" ON "scheduled_events"("status", "locked_at");

-- CreateIndex
CREATE INDEX "scheduled_events_type_room_id_post_id_character_id_status_idx" ON "scheduled_events"("type", "room_id", "post_id", "character_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "room_analysis_snapshots_room_id_key" ON "room_analysis_snapshots"("room_id");

-- CreateIndex
CREATE INDEX "llm_usages_provider_created_at_idx" ON "llm_usages"("provider", "created_at");

-- CreateIndex
CREATE INDEX "llm_usages_room_id_idx" ON "llm_usages"("room_id");

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_model_profile_id_fkey" FOREIGN KEY ("model_profile_id") REFERENCES "model_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_reply_to_fkey" FOREIGN KEY ("reply_to") REFERENCES "posts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_quote_of_fkey" FOREIGN KEY ("quote_of") REFERENCES "posts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_used_by_id_fkey" FOREIGN KEY ("used_by_id") REFERENCES "user_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_memberships" ADD CONSTRAINT "room_memberships_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_events" ADD CONSTRAINT "scheduled_events_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_events" ADD CONSTRAINT "scheduled_events_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_events" ADD CONSTRAINT "scheduled_events_thread_root_id_fkey" FOREIGN KEY ("thread_root_id") REFERENCES "posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_events" ADD CONSTRAINT "scheduled_events_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_usages" ADD CONSTRAINT "token_usages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_analysis_snapshots" ADD CONSTRAINT "room_analysis_snapshots_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_usages" ADD CONSTRAINT "llm_usages_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
