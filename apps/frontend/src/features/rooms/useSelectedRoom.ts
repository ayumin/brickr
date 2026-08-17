import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { RoomSummaryDto } from "@brickr/shared";

import {
  api,
  ApiError,
  isAbortError,
  isForbiddenError,
  isUnauthorizedError,
  toErrorMessage,
} from "../../services/api-client";
import { useAuth } from "../auth/AuthContext";
import { checkRoomAccess } from "../../app/route-access";

export type SelectedRoomState =
  | { status: "loading" }
  | { status: "denied" }
  | { status: "error"; message: string }
  | { status: "ready"; room: RoomSummaryDto };

export type UseSelectedRoomResult = {
  state: SelectedRoomState;
  reload: () => void;
  rename: (title: string) => Promise<void>;
  stop: () => Promise<void>;
  resume: () => Promise<void>;
  archive: () => Promise<void>;
  delete: () => Promise<void>;
};

/**
 * One room's basics — fetch, access decision, and the rename/stop/resume
 * mutations that all just need to refetch afterward (§19.2, Issue #51).
 *
 * Extracted out of `RoomScreen` so `RoomHeader`/`RoomInfoPanel`/`RoomInfoSheet`
 * share the same state instead of each re-fetching (or worse, drifting after
 * one of them renames/stops/resumes the room).
 */
export function useSelectedRoom(roomId: string): UseSelectedRoomResult {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<SelectedRoomState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    api
      .getRoom(roomId, controller.signal)
      .then(({ room }) => {
        const decision = checkRoomAccess(room, user);
        setState(decision.allowed ? { status: "ready", room: room } : { status: "denied" });
      })
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return;
        if (
          isUnauthorizedError(cause) ||
          isForbiddenError(cause) ||
          (cause instanceof ApiError && cause.isNotFound)
        ) {
          setState({ status: "denied" });
          return;
        }
        setState({ status: "error", message: toErrorMessage(cause) });
      });
    return () => controller.abort();
  }, [roomId, user, reloadToken]);

  // Denial always redirects to the feed, never a distinct 403/404 screen
  // (§6.3, mirrors `SessionGate`/`route-access.ts`).
  useEffect(() => {
    if (state.status === "denied") {
      navigate("/", { replace: true });
    }
  }, [state.status, navigate]);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  const rename = useCallback(
    async (title: string): Promise<void> => {
      await api.updateRoom(roomId, { title });
      reload();
    },
    [roomId, reload],
  );

  const stop = useCallback(async (): Promise<void> => {
    await api.stopRoom(roomId);
    reload();
  }, [roomId, reload]);

  const resume = useCallback(async (): Promise<void> => {
    await api.resumeRoom(roomId);
    reload();
  }, [roomId, reload]);

  const archive = useCallback(async (): Promise<void> => {
    await api.archiveRoom(roomId);
    reload();
  }, [roomId, reload]);

  const deleteRoom = useCallback(async (): Promise<void> => {
    await api.deleteRoom(roomId);
    // After deletion, navigate away — the room no longer exists.
    navigate("/rooms", { replace: true });
  }, [roomId, navigate]);

  return { state, reload, rename, stop, resume, archive, delete: deleteRoom };
}
