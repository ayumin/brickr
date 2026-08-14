import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";

import { castPath, normalizeHandleParam, roomListPath } from "../routes";
import { CastManagementScreen } from "../features/cast/CastManagementScreen";
import { RoomListScreen } from "../features/rooms/RoomListScreen";
import { PostDetailScreen } from "../features/rooms/PostDetailScreen";
import { PublicProfileScreen } from "../features/profile/PublicProfileScreen";
import { SettingsShell } from "../features/settings/SettingsShell";
import { SimulationAnalysis } from "../features/simulation/SimulationAnalysis";
import { legacyRedirectTarget } from "./legacy-redirects";

function LegacyRedirect() {
  const location = useLocation();
  const target = legacyRedirectTarget(location.pathname);
  return target ? <Navigate to={target} replace /> : <NotFoundScreen />;
}

function RoomAnalysisRoute() {
  const { roomId } = useParams<{ roomId: string }>();
  if (!roomId) return <NotFoundScreen />;
  return <SimulationAnalysis simulationId={roomId} />;
}

function HandleRoute() {
  const { handle: raw } = useParams<{ handle: string }>();
  const handle = normalizeHandleParam(raw);
  if (!handle) return <NotFoundScreen />;
  return <PublicProfileScreen handle={handle} />;
}

function PostRoute() {
  const { postId } = useParams<{ postId: string }>();
  if (!postId) return <NotFoundScreen />;
  return <PostDetailScreen postId={postId} />;
}

function NotFoundScreen() {
  return (
    <div className="px-4 py-12 text-center text-sm text-ink-faint">
      このURLに対応する画面はありません。
    </div>
  );
}

/**
 * The ordinary `<Route>` tree (§13.5): everything here mounts/unmounts like
 * any React Router app. Feed (`/`) and an open Room (`/rooms/:roomId`) are
 * deliberately absent - `AppShell` renders those itself, outside this tree,
 * so they are never unmounted by a route change (see `AppShell.tsx`).
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path={castPath()} element={<CastManagementScreen />} />
      <Route path={roomListPath()} element={<RoomListScreen />} />
      <Route path="/rooms/:roomId/analysis" element={<RoomAnalysisRoute />} />
      <Route path="/settings/:section" element={<SettingsShell />} />
      <Route path="/posts/:postId" element={<PostRoute />} />

      <Route path="/characters" element={<LegacyRedirect />} />
      <Route path="/simulations" element={<LegacyRedirect />} />
      <Route path="/simulations/:id/analysis" element={<LegacyRedirect />} />

      <Route path="/:handle" element={<HandleRoute />} />
      <Route path="*" element={<NotFoundScreen />} />
    </Routes>
  );
}
