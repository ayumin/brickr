import { useCallback, useEffect, useState } from "react";
import type {
  RoomAnalysisSnapshotDto,
  UpdateRoomAnalysisSnapshotResponse,
} from "@brickr/shared";

import { api, ApiError, isAbortError, isForbiddenError, toErrorMessage } from "../../services/api-client";

export type RoomAnalysisSnapshotState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "none" }
  | { status: "ready"; snapshot: RoomAnalysisSnapshotDto }
  | { status: "error"; message: string };

export type RoomAnalysisUpdateOutcome = "updated" | "unchanged";

export function toRoomAnalysisUpdateResult(result: UpdateRoomAnalysisSnapshotResponse): {
  state: RoomAnalysisSnapshotState;
  outcome: RoomAnalysisUpdateOutcome;
} {
  return {
    state: { status: "ready", snapshot: result.snapshot },
    outcome: result.updated ? "updated" : "unchanged",
  };
}

export type UseRoomAnalysisSnapshotResult = {
  state: RoomAnalysisSnapshotState;
  /** True while an update (POST) request is in flight. */
  updating: boolean;
  /** Error from the last update attempt, if any. */
  updateError: string | null;
  /** Whether the last successful request regenerated the analysis. */
  updateOutcome: RoomAnalysisUpdateOutcome | null;
  /** Dismiss the update error banner. */
  dismissUpdateError: () => void;
  /**
   * Triggers a snapshot update (owner only). Resolves when the request
   * completes. The result is exposed through `updateOutcome`.
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
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateOutcome, setUpdateOutcome] = useState<RoomAnalysisUpdateOutcome | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    setUpdateOutcome(null);
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
  }, [roomId]);

  const update = useCallback(async (): Promise<void> => {
    setUpdating(true);
    setUpdateError(null);
    setUpdateOutcome(null);
    try {
      const result = toRoomAnalysisUpdateResult(await api.updateRoomSnapshot(roomId));
      setState(result.state);
      setUpdateOutcome(result.outcome);
    } catch (cause) {
      setUpdateError(toErrorMessage(cause));
    } finally {
      setUpdating(false);
    }
  }, [roomId]);

  const dismissUpdateError = useCallback(() => setUpdateError(null), []);

  return { state, updating, updateError, updateOutcome, dismissUpdateError, update };
}
