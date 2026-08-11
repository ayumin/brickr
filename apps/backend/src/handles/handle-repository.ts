import type { HandleOwnerType } from "@brickr/shared";
import type { Db } from "../persistence/prisma.js";
import { normalizeHandle, type HandleOwner } from "./handle.js";

export class HandleRepository {
  constructor(private readonly db: Db) {}

  async findByHandle(handle: string): Promise<HandleOwner | null> {
    const row = await this.db.handleOwner.findUnique({
      where: { handle: normalizeHandle(handle) },
    });
    if (!row) return null;

    const ownerType = toOwnerType(row.ownerType);
    if (!ownerType) return null;

    return { handle: row.handle, ownerType, ownerId: row.ownerId };
  }
}

/** An unrecognised owner kind is treated as no owner rather than trusted. */
function toOwnerType(value: string): HandleOwnerType | null {
  return value === "user" || value === "character" ? value : null;
}
