import { useCallback, useEffect, useRef, useState } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import type { SimulationDto, SimulationSummaryDto } from "@brickr/shared";

import { APP_FULL_NAME, APP_NAME, APP_TAGLINE } from "./brand";
import { BrandLogo } from "./components/BrandLogo";
import { ErrorBanner } from "./components/ErrorBanner";
import { Spinner } from "./components/Spinner";
import { AuthProvider } from "./features/auth/AuthContext";
import { LoginPage } from "./features/auth/LoginPage";
import { SignupPage } from "./features/auth/SignupPage";
import { ApiError, api, isAbortError, isUnauthorizedError, toErrorMessage } from "./services/api-client";
import { applyTheme, readPreferredTheme, type Theme } from "./services/theme";
import { SimulationView } from "./features/simulation/SimulationView";
import { useCharacters } from "./hooks/useCharacters";
import { useUserProfile } from "./hooks/useUserProfile";
import type { LoadPhase } from "./types";

const SIMULATION_STORAGE_KEY = "brickr.simulationId";

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
  return `${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())} のシミュレーション`;
}

/**
 * Bootstraps (or joins) a Simulation and renders the main app shell.
 * Split out from `App` so `/login` and `/signup` can be real top-level
 * routes that don't need a Simulation at all - unlike every view inside
 * `SimulationView`, which stay one persistent component (see routes.ts).
 */
function SimulationBootstrap() {
  const navigate = useNavigate();
  const userProfile = useUserProfile();
  const {
    characters,
    loading: charactersLoading,
    error: charactersError,
    reload: reloadCharacters,
    remove: removeCharacters,
  } = useCharacters();

  const [simulation, setSimulation] = useState<SimulationDto | null>(null);
  const [simulations, setSimulations] = useState<SimulationSummaryDto[]>([]);
  const [simulationsLoading, setSimulationsLoading] = useState(false);
  const [simulationsError, setSimulationsError] = useState<string | null>(null);
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(readPreferredTheme);

  const loadSimulations = useCallback(async (): Promise<void> => {
    setSimulationsLoading(true);
    setSimulationsError(null);
    try {
      setSimulations(await api.getSimulations());
    } catch (cause) {
      if (!isAbortError(cause)) setSimulationsError(toErrorMessage(cause));
    } finally {
      setSimulationsLoading(false);
    }
  }, []);

  /**
   * Resolve the simulation to show: reuse the id kept in localStorage when the
   * backend still knows it; otherwise join the most recently created
   * Simulation if one exists; otherwise create a new one.
   *
   * The "join existing" step matters now that creating a Simulation requires
   * a session (§66.3): a signed-out visitor has no way to create one, but
   * reading is public, and CLAUDE.md §66.3 says any Simulation is joinable by
   * anyone. Only falling back to create() when nothing exists at all avoids
   * spawning a fresh Simulation on every empty-localStorage load, which was
   * wasteful even before login existed.
   */
  const bootstrap = useCallback(async (): Promise<void> => {
    setPhase((current) => (current === "ready" ? current : "loading"));
    setError(null);

    try {
      const storedId = readStoredSimulationId();

      if (storedId) {
        try {
          const existing = await api.getSimulation(storedId);

          // A legacy stopped simulation is resumed automatically when
          // restored, since prior to Simulation ownership (#25) that was the
          // only way to keep using it. Note: this will 401/403 for anyone who
          // is not the Simulation's creator or an admin (§66.3) - a
          // pre-existing gap this MR does not attempt to fix.
          const restored =
            existing.simulation.status === "stopped"
              ? await api.resumeSimulation(existing.simulation.id)
              : existing.simulation;
          setSimulation(restored);
          setPhase("ready");
          return;
        } catch (cause) {
          if (!(cause instanceof ApiError && cause.isNotFound)) {
            throw cause;
          }
          // The stored simulation is gone (e.g. the database was reset).
          storeSimulationId(null);
        }
      }

      const existingSimulations = await api.getSimulations();
      const mostRecent = [...existingSimulations].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )[0];
      if (mostRecent) {
        // Loaded as-is, not auto-resumed: unlike the legacy path above, this
        // is the common case for every signed-out (or simply second) visitor,
        // and only the Simulation's creator or an admin may resume it.
        const joined = await api.getSimulation(mostRecent.id);
        storeSimulationId(joined.simulation.id);
        setSimulation(joined.simulation);
        setPhase("ready");
        return;
      }

      const created = await api.createSimulation({ title: defaultTitle() });
      storeSimulationId(created.id);
      setSimulation(created);
      setPhase("ready");
    } catch (cause) {
      if (isAbortError(cause)) {
        return;
      }
      // Only reachable when nothing exists yet and the visitor is signed
      // out: creating the first Simulation requires a session. Send them to
      // log in instead of showing a raw "sign in to continue" error screen.
      if (isUnauthorizedError(cause)) {
        navigate("/login");
        return;
      }
      setError(toErrorMessage(cause));
      setPhase("error");
    }
  }, [navigate]);

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

  useEffect(() => {
    if (phase === "ready") void loadSimulations();
  }, [loadSimulations, phase, simulation?.id]);

  const selectSimulation = useCallback(async (id: string): Promise<void> => {
    setError(null);
    try {
      const existing = await api.getSimulation(id);
      const selected =
        existing.simulation.status === "stopped"
          ? await api.resumeSimulation(id)
          : existing.simulation;
      storeSimulationId(selected.id);
      setSimulation(selected);
    } catch (cause) {
      setError(toErrorMessage(cause));
      throw cause;
    }
  }, []);

  const createSimulation = useCallback(async (title: string): Promise<void> => {
    setError(null);
    try {
      const created = await api.createSimulation({ title });
      storeSimulationId(created.id);
      setSimulation(created);
    } catch (cause) {
      setError(toErrorMessage(cause));
      throw cause;
    }
  }, []);

  const renameSimulation = useCallback(
    async (id: string, title: string): Promise<void> => {
      setError(null);
      try {
        const renamed = await api.updateSimulation(id, { title });
        setSimulation((current) => (current?.id === id ? renamed : current));
        await loadSimulations();
      } catch (cause) {
        setError(toErrorMessage(cause));
        throw cause;
      }
    },
    [loadSimulations],
  );

  const dismissError = useCallback(() => {
    setError(null);
  }, []);

  const selectTheme = useCallback((selected: Theme) => {
    applyTheme(selected);
    setTheme(selected);
  }, []);

  if (phase === "loading" || (!simulation && phase !== "error")) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <BrandLogo className="h-16 w-16" />
        <div>
          <p className="font-bold text-ink">{APP_NAME}</p>
          <p className="text-xs text-ink-faint">{APP_TAGLINE}</p>
        </div>
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
          <h1 className="flex items-center justify-center gap-2 text-center text-lg font-bold text-ink">
            <BrandLogo className="h-7 w-7" />
            {APP_FULL_NAME}
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
      key={simulation.id}
      simulation={simulation}
      simulations={simulations}
      simulationsLoading={simulationsLoading}
      simulationsError={simulationsError}
      onReloadSimulations={loadSimulations}
      onSelectSimulation={selectSimulation}
      onCreateSimulation={createSimulation}
      onRenameSimulation={renameSimulation}
      characters={characters}
      charactersLoading={charactersLoading}
      charactersError={charactersError}
      onReloadCharacters={reloadCharacters}
      onCharactersDeleted={removeCharacters}
      userProfile={userProfile.profile}
      userProfileError={userProfile.error}
      onReloadUserProfile={userProfile.reload}
      onUserProfileUpdated={userProfile.setProfile}
      theme={theme}
      onThemeChange={selectTheme}
      bootstrapError={error}
      onDismissBootstrapError={dismissError}
    />
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        {/* Everything else is view-switching inside SimulationBootstrap /
            SimulationView, handled by routes.ts rather than by <Route>. */}
        <Route path="*" element={<SimulationBootstrap />} />
      </Routes>
    </AuthProvider>
  );
}
