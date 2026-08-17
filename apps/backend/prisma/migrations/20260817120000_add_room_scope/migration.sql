-- CreateEnum
CREATE TYPE "RoomScope" AS ENUM ('global', 'room');

-- AlterTable: add scope column with a temporary nullable default so the
-- backfill can run before we enforce NOT NULL.
ALTER TABLE "rooms" ADD COLUMN "scope" "RoomScope";

-- Backfill: the reserved Feed room gets 'global'; every other room gets 'room'.
UPDATE "rooms"
SET "scope" = 'global'
WHERE "id" = '20000000-0000-4000-8000-000000000001';

UPDATE "rooms"
SET "scope" = 'room'
WHERE "scope" IS NULL;

-- Now that every row has a value, enforce NOT NULL and set the default for
-- future inserts.
ALTER TABLE "rooms"
  ALTER COLUMN "scope" SET NOT NULL,
  ALTER COLUMN "scope" SET DEFAULT 'room';
