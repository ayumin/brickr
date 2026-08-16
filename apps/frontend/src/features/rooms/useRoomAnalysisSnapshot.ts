import { useCallback, useEffect, useState } from "react";
import type { RoomAnalysisSnapshotDto } from "@brickr/shared";

import { api, ApiError, isAbortError, isForbiddenError, toErrorMessage } from "../../services/api-client";

export type RoomAnalysisSnapshotState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "none" }
  | { status: "ready"; snapshot: RoomAnalysisSnapshotDto }
  | { status: "error"; message: string };

export type UseRoomAnalysisSnapshotResult = {
  state: RoomAnalysisSnapshotState;
  /** True while an update (POST) request is in flight. */
  updating: boolean;
  /** Error from the last update attempt, if any. */
  updateError: string | null;
  /** Dismiss the update error banner. */
  dismissUpdateError: () => void;
  /**
   * Triggers a snapshot update (owner only). Resolves when the request
   * completes. Callers should check `updateError` afterward.
   */
  update: () => Promise<void>;
};

/**
 * Fetches and manages the room analysis snapshot for the right panel (issue #170).
 *
 * - Loads the snapshot on mount and whenever `roomId` changes.
 * - Exposes `update()` for the owner to regenerate the snapshot.
 * - Handles forbidden (non-member of closed room) gracefully.
 * - Handles 404 (no snapshot yet) as `status: "none"`.
 */
export function useRoomAnalysisSnapshot(roomId: string): UseRoomAnalysisSnapshotResult {
  const [state, setState] = useState<RoomAnalysisSnapshotState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    api
      .getRoomSnapshot(roomId, controller.signal)
      .then((snapshot) => {
        setState({ status: "ready", snapshot });
      })
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return;
        if (isForbiddenError(cause)) {
          setState({ status: "forbidden" });
          return;
        }
        // 404 means no snapshot has been generated yet.
        if (cause instanceof ApiError && cause.isNotFound) {
          setState({ status: "none" });
          return;
        }
        setState({ status: "error", message: toErrorMessage(cause) });
      });
    return () => controller.abort();
  }, [roomId, reloadToken]);

  const update = useCallback(async (): Promise<void> => {
    setUpdating(true);
    setUpdateError(null);
    try {
      const { snapshot } = await api.updateRoomSnapshot(roomId);
      setState({ status: "ready", snapshot });
      // Bump reload token so the GET re-runs on next mount if needed.
      setReloadToken((t) => t + 1);
    } catch (cause) {
      setUpdateError(toErrorMessage(cause));
    } finally {
      setUpdating(false);
    }
  }, [roomId]);

  const dismissUpdateError = useCallback(() => setUpdateError(null), []);

  return { state, updating, updateError, dismissUpdateError, update };
}
