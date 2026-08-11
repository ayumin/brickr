import type { HandleOwnerType } from "@brickr/shared";
import { isUniqueConstraintError, type DbTransaction } from "../persistence/prisma.js";
import { HandleTakenError, normalizeHandle, type HandleOwner } from "./handle.js";

/**
 * Writes to the shared handle namespace (CLAUDE.md §66.13).
 *
 * Both functions take a transaction client rather than opening their own, so a
 * handle is always claimed in the same transaction as the row that owns it. A
 * row without its handle, or a handle without its row, is never observable.
 */

/**
 * Takes `owner.handle` for `owner`, releasing whatever it held before. That
 * makes a first claim and a rename the same operation.
 *
 * The primary key on `handle` is what rejects a handle already held by someone
 * else, which is the entire point of the table.
 */
export async function claimHandle(tx: DbTransaction, owner: HandleOwner): Promise<void> {
  const handle = normalizeHandle(owner.handle);

  await tx.handleOwner.deleteMany({
    where: { ownerType: owner.ownerType, ownerId: owner.ownerId },
  });

  try {
    await tx.handleOwner.create({
      data: { handle, ownerType: owner.ownerType, ownerId: owner.ownerId },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new HandleTakenError(handle);
    throw error;
  }
}

/**
 * Frees handles so someone else can take them.
 *
 * Only hard deletion should call this. Soft deletion keeps the handle reserved,
 * because the owner still appears as the author of past posts (§48).
 */
export async function releaseHandles(
  tx: DbTransaction,
  ownerType: HandleOwnerType,
  ownerIds: string[],
): Promise<void> {
  if (ownerIds.length === 0) return;
  await tx.handleOwner.deleteMany({ where: { ownerType, ownerId: { in: ownerIds } } });
}
