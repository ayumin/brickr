/**
 * Waits for the current poll iteration to settle, bounded by the shutdown
 * grace period. A rejection still counts as settled: the caller only needs to
 * know whether it is safe to disconnect shared resources.
 */
export async function waitForCurrentWork(
  currentWork: Promise<void> | null,
  timeoutMs: number,
): Promise<boolean> {
  if (!currentWork) return true;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const completed = await Promise.race([
    currentWork.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
  return completed;
}
