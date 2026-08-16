export const SSE_REFRESH_DEBOUNCE_MS = 250;

export type RefreshScheduler = {
  schedule: () => void;
  cancel: () => void;
};

/** Coalesces a burst of state-change notifications into one REST refresh. */
export function createRefreshScheduler(
  refresh: () => void,
  delayMs: number = SSE_REFRESH_DEBOUNCE_MS,
): RefreshScheduler {
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    schedule(): void {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        refresh();
      }, delayMs);
    },
    cancel(): void {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
