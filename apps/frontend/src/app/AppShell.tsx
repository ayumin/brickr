import { useEffect, useState } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";

import { castPath, roomListPath, settingsPath } from "../routes";
import { useAuth } from "../features/auth/AuthContext";
import { ComposeControllerProvider, useComposeController } from "../features/composer/ComposeContext";
import { FeedScreen } from "../features/feed/FeedScreen";
import { RoomScreen } from "../features/rooms/RoomScreen";
import { clearSelectedRoomId } from "../features/rooms/selected-room-storage";
import { AppNavigation, type NavActiveItem } from "./AppNavigation";
import { AppRoutes } from "./AppRoutes";
import { MobileNavigation } from "./MobileNavigation";

/** Opened rooms kept mounted beyond this many are dropped, oldest first (never the active one). */
const MAX_OPEN_ROOMS = 3;

function activeItemFor(pathname: string): NavActiveItem {
  if (pathname === "/") return "feed";
  if (matchPath({ path: "/cast", end: false }, pathname)) return "cast";
  if (matchPath({ path: "/rooms", end: true }, pathname) || matchPath({ path: "/rooms/:id", end: true }, pathname)) {
    return "rooms";
  }
  return "other";
}

/**
 * The persistent app shell (§13.1, §13.5, §14) that replaces the old
 * the old bootstrap + always-mounted room view.
 *
 * Feed and each opened Room stay in the tree permanently once reached
 * (toggled with the `hidden` attribute, never unmounted), so their SSE
 * subscriptions and loaded posts survive navigating to Cast/Rooms-list/
 * Settings/a profile and back. `AppRoutes`'s ordinary `<Route>` tree only
 * ever renders for a path that matches neither - it has no entry for `/` or
 * `/rooms/:id` at all, so there is no double-render/priority question.
 */
export function AppShell() {
  return (
    <ComposeControllerProvider>
      <AppShellContent />
    </ComposeControllerProvider>
  );
}

function AppShellContent() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const composeController = useComposeController();

  const roomMatch = matchPath({ path: "/rooms/:roomId", end: true }, location.pathname);
  const activeRoomId = roomMatch?.params.roomId ?? null;
  const isFeedRoute = location.pathname === "/";
  const isSettingsRoute = matchPath({ path: "/settings/:section", end: false }, location.pathname) !== null;

  const [openRoomIds, setOpenRoomIds] = useState<string[]>([]);
  useEffect(() => {
    if (!activeRoomId) return;
    setOpenRoomIds((current) => {
      const next = [...current.filter((id) => id !== activeRoomId), activeRoomId];
      return next.length > MAX_OPEN_ROOMS ? next.slice(next.length - MAX_OPEN_ROOMS) : next;
    });
  }, [activeRoomId]);

  const navProps = {
    currentUser: user,
    sessionLoading: loading,
    activeItem: activeItemFor(location.pathname),
    // Compose is only available from within a Room (§168): the feed is
    // read-only, so the button is hidden there.
    showComposeButton: activeRoomId !== null,
    onOpenFeed: () => {
      clearSelectedRoomId();
      navigate("/");
    },
    onOpenCast: () => navigate(castPath()),
    onOpenRooms: () => navigate(roomListPath()),
    onOpenSettings: () =>
      navigate(settingsPath("profile"), { state: { returnTo: location.pathname } }),
    onComposeClick: () => {
      if (activeRoomId) {
        composeController.request({
          context: { mode: "new", roomId: activeRoomId, roomLabel: "ルーム" },
        });
      }
    },
  };

  return (
    <div className="flex min-h-dvh">
      {isSettingsRoute ? null : <AppNavigation {...navProps} />}

      <main className="min-w-0 flex-1 pb-16 lg:pb-0">
        <div hidden={!isFeedRoute}>
          <FeedScreen />
        </div>

        {openRoomIds.map((roomId) => (
          <div key={roomId} hidden={activeRoomId !== roomId}>
            <RoomScreen roomId={roomId} />
          </div>
        ))}

        {!isFeedRoute && activeRoomId === null ? <AppRoutes /> : null}
      </main>

      {isSettingsRoute ? null : <MobileNavigation {...navProps} />}
    </div>
  );
}
