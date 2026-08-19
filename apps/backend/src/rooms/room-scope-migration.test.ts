/**
 * Guards against the `add_room_scope` migration's backfill silently drifting
 * from the `DEFAULT_ROOM_ID` constant (MR !100 review).
 *
 * SQL migrations cannot import a TS constant, so the Feed room id is a
 * literal in `migration.sql`. If that literal ever diverges from
 * `DEFAULT_ROOM_ID`, the backfill marks the wrong row (or none) as `global`,
 * silently defeating Feed-room protection without any other test failing —
 * this test reads the migration file directly so that drift is caught here
 * instead.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_ROOM_ID } from "@brickr/shared";

const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../prisma/migrations/20260817120000_add_room_scope/migration.sql",
);

describe("add_room_scope migration", () => {
  it("backfills scope: global onto the same id as DEFAULT_ROOM_ID", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain(`'${DEFAULT_ROOM_ID}'`);
  });
});
