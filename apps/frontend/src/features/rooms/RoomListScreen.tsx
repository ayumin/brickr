import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { SimulationSummaryDto } from "@brickr/shared";

import { useAuth } from "../auth/AuthContext";
import { roomAnalysisPath, roomPath } from "../../routes";
import { api, isAbortError, toErrorMessage } from "../../services/api-client";
import { writeSelectedRoomId } from "./selected-room-storage";
import { SimulationList } from "../simulation/SimulationList";
import { SimulationNameDialog } from "../simulation/SimulationNameDialog";

/**
 * The room list (§5.3, §6.1, §19.1) - login required, ordinary mount/unmount
 * screen (§13.5): unlike Feed/Room it costs nothing to refetch on return.
 *
 * Wraps the existing, already-complete SimulationList/SimulationNameDialog
 * rather than rebuilding them; only the data source (its own lazy fetch
 * instead of an app-bootstrap prop) and the destination of "select"/"create"
 * (navigate to /rooms/:id, no auto-resume) are new here.
 */
export function RoomListScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [simulations, setSimulations] = useState<SimulationSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "rename"; simulation: SimulationSummaryDto } | null
  >(null);

  const load = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api
      .getSimulations(controller.signal)
      .then(setSimulations)
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return;
        setError(toErrorMessage(cause));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [reloadToken]);

  const openRoom = useCallback(
    async (id: string): Promise<void> => {
      writeSelectedRoomId(id);
      navigate(roomPath(id));
    },
    [navigate],
  );

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="border-b border-line px-4 py-3">
        <h1 className="font-display text-lg font-bold text-ink">ルーム</h1>
      </header>

      <SimulationList
        simulations={simulations}
        currentId=""
        currentUserId={user?.id ?? ""}
        isAdmin={user?.isAdmin ?? false}
        loading={loading}
        error={error}
        onRetry={load}
        onSelect={openRoom}
        onCreate={() => setDialog({ mode: "create" })}
        onRename={(simulation) => setDialog({ mode: "rename", simulation })}
        onAnalyze={(id) => navigate(roomAnalysisPath(id))}
      />

      {dialog ? (
        <SimulationNameDialog
          mode={dialog.mode}
          {...(dialog.mode === "rename" ? { initialValue: dialog.simulation.title ?? "" } : {})}
          onClose={() => setDialog(null)}
          onSave={async (title) => {
            if (dialog.mode === "create") {
              const created = await api.createSimulation({ title });
              writeSelectedRoomId(created.id);
              setDialog(null);
              navigate(roomPath(created.id));
            } else {
              await api.updateSimulation(dialog.simulation.id, { title });
              setDialog(null);
              load();
            }
          }}
        />
      ) : null}
    </div>
  );
}
