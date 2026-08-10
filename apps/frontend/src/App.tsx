import { useCallback, useEffect, useRef, useState } from "react";
import type { SimulationDto } from "@enjo/shared";

import { ErrorBanner } from "./components/ErrorBanner";
import { Spinner } from "./components/Spinner";
import { ApiError, api, isAbortError, toErrorMessage } from "./services/api-client";
import { SimulationView } from "./features/simulation/SimulationView";
import { useCharacters } from "./hooks/useCharacters";
import type { LoadPhase } from "./types";

const SIMULATION_STORAGE_KEY = "enjo.simulationId";

function readStoredSimulationId(): string | null {
  try {
    return window.localStorage.getItem(SIMULATION_STORAGE_KEY);
  } catch {
    // Private mode / blocked storage: just start a fresh simulation.
    return null;
  }
}

function storeSimulationId(id: string | null): void {
  try {
    if (id === null) {
      window.localStorage.removeItem(SIMULATION_STORAGE_KEY);
    } else {
      window.localStorage.setItem(SIMULATION_STORAGE_KEY, id);
    }
  } catch {
    // Non-fatal: the simulation still works, it just won't survive a reload.
  }
}

function defaultTitle(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())} のスレッド`;
}

export default function App() {
  const {
    characters,
    loading: charactersLoading,
    error: charactersError,
    reload: reloadCharacters,
  } = useCharacters();

  const [simulation, setSimulation] = useState<SimulationDto | null>(null);
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);

  /**
   * Resolve the simulation to show: reuse the id kept in localStorage when the
   * backend still knows it, otherwise create a new one.
   */
  const bootstrap = useCallback(async (): Promise<void> => {
    setPhase((current) => (current === "ready" ? current : "loading"));
    setError(null);

    try {
      const storedId = readStoredSimulationId();

      if (storedId) {
        try {
          const existing = await api.getSimulation(storedId);

          // A stopped thread rejects new posts with 409, so restoring one would
          // leave the composer permanently broken after a reload. Start fresh
          // instead; the old thread is still reachable through the API.
          if (existing.simulation.status !== "stopped") {
            setSimulation(existing.simulation);
            setPhase("ready");
            return;
          }
          storeSimulationId(null);
        } catch (cause) {
          if (!(cause instanceof ApiError && cause.isNotFound)) {
            throw cause;
          }
          // The stored simulation is gone (e.g. the database was reset).
          storeSimulationId(null);
        }
      }

      const created = await api.createSimulation({ title: defaultTitle() });
      storeSimulationId(created.id);
      setSimulation(created);
      setPhase("ready");
    } catch (cause) {
      if (isAbortError(cause)) {
        return;
      }
      setError(toErrorMessage(cause));
      setPhase("error");
    }
  }, []);

  // Run exactly once, even under StrictMode's double effect invocation —
  // otherwise we would create two simulations on every mount.
  const bootstrappedRef = useRef(false);
  useEffect(() => {
    if (bootstrappedRef.current) {
      return;
    }
    bootstrappedRef.current = true;
    void bootstrap();
  }, [bootstrap]);

  const handleRestart = useCallback(() => {
    setRestarting(true);
    setError(null);

    void api
      .createSimulation({ title: defaultTitle() })
      .then((created) => {
        storeSimulationId(created.id);
        setSimulation(created);
        setPhase("ready");
      })
      .catch((cause: unknown) => {
        setError(toErrorMessage(cause));
      })
      .finally(() => {
        setRestarting(false);
      });
  }, []);

  const handleSimulationUpdated = useCallback((updated: SimulationDto) => {
    setSimulation(updated);
  }, []);

  const dismissError = useCallback(() => {
    setError(null);
  }, []);

  if (phase === "loading" || (!simulation && phase !== "error")) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <span className="text-3xl" aria-hidden="true">
          🔥
        </span>
        <Spinner size="lg" />
        <p className="text-sm text-ink-muted">
          シミュレーションを準備しています…
        </p>
      </div>
    );
  }

  if (!simulation) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-6">
        <div className="w-full max-w-md space-y-4">
          <h1 className="text-center text-lg font-bold text-ink">
            🔥 炎上シミュレータ
          </h1>
          <ErrorBanner
            message="起動できませんでした"
            detail={error ?? "バックエンドの状態を確認してください。"}
            onRetry={() => {
              void bootstrap();
            }}
          />
          <p className="text-center text-xs text-ink-faint">
            バックエンドが起動しているか、
            <code className="text-ink-muted">VITE_API_BASE_URL</code>
            の設定が正しいか確認してください。
          </p>
        </div>
      </div>
    );
  }

  return (
    <SimulationView
      simulation={simulation}
      characters={characters}
      charactersLoading={charactersLoading}
      charactersError={charactersError}
      onReloadCharacters={reloadCharacters}
      onSimulationUpdated={handleSimulationUpdated}
      onRestart={handleRestart}
      restarting={restarting}
      bootstrapError={error}
      onDismissBootstrapError={dismissError}
    />
  );
}
