-- CreateEnum
CREATE TYPE "MembershipOrigin" AS ENUM ('request', 'invitation');

-- AlterTable: add nullable origin column to room_memberships.
-- Null for non-pending memberships (active, left, removed, banned).
-- Existing pending rows (created before this migration) have no origin
-- and remain null — they are treated as legacy entries.
ALTER TABLE "room_memberships" ADD COLUMN "origin" "MembershipOrigin";
