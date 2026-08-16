import type { DbTransaction } from "../persistence/prisma.js";

/**
 * What the hard delete has to observe before it runs, because the database nulls
 * the surviving replies' `replyTo`: afterwards nothing identifies which posts lost
 * their parent, or which thread the deleted posts belonged to.
 */
export type ThreadRepairInput = {
  /** Surviving posts whose parent was deleted, each now the root of what is left below it. */
  newRootIds: string[];
  /**
   * Roots the deleted posts belonged to, minus the ones deleted themselves. A
   * root can outlive a reply below it, and then part of its thread leaves.
   */
  detachedRootIds: string[];
  /** Room ids whose `lastActivityAt` must be recalculated after the delete. */
  roomIds: string[];
};

/**
 * Repairs the denormalised thread information a hard delete leaves behind (§8.5).
 *
 * Deleting a character removes only that character's posts; replies written by
 * other accounts survive, and that meaning is deliberately unchanged. The price
 * is this repair: `threadRootId` is a denormalised value, so a surviving reply
 * whose root (or whose whole chain up to the root) has just been deleted would
 * otherwise point at an id that no longer exists, and the thread would disappear
 * from a feed that reads roots by `replyTo = null`.
 *
 * Never an alternative: cascading the delete to other accounts' replies. That
 * would be data loss dressed up as cleanup.
 */
export async function repairThreads(tx: DbTransaction, input: ThreadRepairInput): Promise<void> {
  for (const rootId of input.newRootIds) {
    const subtree = await collectSubtree(tx, rootId);

    await tx.post.updateMany({
      where: { id: { in: subtree } },
      data: { threadRootId: rootId },
    });

    await dateRootFromSubtree(tx, rootId, subtree);
  }

  // The root an orphaned subtree was cut from needs the same treatment. Its
  // `threadActivityAt` was pushed forward by every reply below it, including the
  // ones that have just become a thread of their own — leaving it credited with
  // activity its remaining thread no longer contains, which would keep it near
  // the top of the feed for nothing.
  //
  // After the promotions above, so the subtree walked here is only what still
  // belongs to this thread.
  const promoted = new Set(input.newRootIds);
  for (const rootId of input.detachedRootIds) {
    if (promoted.has(rootId)) continue;
    await dateRootFromSubtree(tx, rootId, await collectSubtree(tx, rootId));
  }

  for (const roomId of input.roomIds) {
    await recalculateSimulationActivity(tx, roomId);
  }
}

/**
 * The thread keeps the position its newest surviving post earns it, rather than
 * jumping to "now" because of an unrelated deletion.
 *
 * A root that was deleted along with the character has no surviving post to
 * aggregate, and is left alone rather than updated into a `RecordNotFound`.
 */
async function dateRootFromSubtree(
  tx: DbTransaction,
  rootId: string,
  subtree: string[],
): Promise<void> {
  const newest = await tx.post.aggregate({
    where: { id: { in: subtree } },
    _max: { createdAt: true },
  });
  if (!newest._max.createdAt) return;

  await tx.post.update({
    where: { id: rootId },
    data: { threadActivityAt: newest._max.createdAt },
  });
}

/**
 * A root plus every surviving descendant, walked one level at a time so a deep
 * chain costs a handful of queries instead of one per post.
 *
 * `seen` is what terminates the walk: `replyTo` always points at an older post,
 * so a cycle cannot occur naturally, but bad data must not loop forever.
 */
async function collectSubtree(tx: DbTransaction, rootId: string): Promise<string[]> {
  const seen = new Set<string>([rootId]);
  let frontier = [rootId];

  while (frontier.length > 0) {
    const children = await tx.post.findMany({
      where: { replyTo: { in: frontier } },
      select: { id: true },
    });

    frontier = children.map((child) => child.id).filter((id) => !seen.has(id));
    for (const id of frontier) seen.add(id);
  }

  return [...seen];
}

/**
 * Re-derives the room's activity from the roots that are left. Falls back to the
 * creation time, which is also what an empty room starts with, so an emptied room
 * does not sort as if it had just been active.
 */
async function recalculateSimulationActivity(
  tx: DbTransaction,
  roomId: string,
): Promise<void> {
  const newest = await tx.post.aggregate({
    where: { roomId, replyTo: null },
    _max: { threadActivityAt: true },
  });

  if (newest._max.threadActivityAt) {
    await tx.room.update({
      where: { id: roomId },
      data: { lastActivityAt: newest._max.threadActivityAt },
    });
    return;
  }

  const room = await tx.room.findUnique({
    where: { id: roomId },
    select: { createdAt: true },
  });
  if (!room) return;

  await tx.room.update({
    where: { id: roomId },
    data: { lastActivityAt: room.createdAt },
  });
}
