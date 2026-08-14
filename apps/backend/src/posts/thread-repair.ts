import type { DbTransaction } from "../persistence/prisma.js";

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
 *
 * `newRootIds` are the surviving posts whose parent was deleted — read before
 * the delete, because the database nulls their `replyTo` and afterwards there is
 * nothing left to identify them by.
 */
export async function repairThreads(
  tx: DbTransaction,
  newRootIds: string[],
  simulationIds: string[],
): Promise<void> {
  for (const rootId of newRootIds) {
    const subtree = await collectSubtree(tx, rootId);

    await tx.post.updateMany({
      where: { id: { in: subtree } },
      data: { threadRootId: rootId },
    });

    // The thread keeps the position its newest surviving post earns it, rather
    // than jumping to "now" because of an unrelated deletion.
    const newest = await tx.post.aggregate({
      where: { id: { in: subtree } },
      _max: { createdAt: true },
    });
    if (newest._max.createdAt) {
      await tx.post.update({
        where: { id: rootId },
        data: { threadActivityAt: newest._max.createdAt },
      });
    }
  }

  for (const simulationId of simulationIds) {
    await recalculateSimulationActivity(tx, simulationId);
  }
}

/**
 * The new root plus every surviving descendant, walked one level at a time so a
 * deep chain costs a handful of queries instead of one per post.
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
  simulationId: string,
): Promise<void> {
  const newest = await tx.post.aggregate({
    where: { simulationId, replyTo: null },
    _max: { threadActivityAt: true },
  });

  if (newest._max.threadActivityAt) {
    await tx.simulation.update({
      where: { id: simulationId },
      data: { lastActivityAt: newest._max.threadActivityAt },
    });
    return;
  }

  const simulation = await tx.simulation.findUnique({
    where: { id: simulationId },
    select: { createdAt: true },
  });
  if (!simulation) return;

  await tx.simulation.update({
    where: { id: simulationId },
    data: { lastActivityAt: simulation.createdAt },
  });
}
