import { Icon, type IconName } from "../components/Icon";
import type { AppNavigationProps } from "./AppNavigation";

function MobileNavItem({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
        active ? "text-accent" : "text-ink-muted"
      }`}
    >
      <Icon name={icon} className="text-lg" />
      {label}
    </button>
  );
}

/**
 * Mobile bottom navigation (§14.2). Same prop shape and visibility rules as
 * `AppNavigation` - signed out sees only フィード + 投稿する (as a floating
 * button, not a bar item, to keep it reachable with a thumb).
 *
 * `env(safe-area-inset-bottom)` padding keeps the bar clear of a device's
 * home indicator; every item is a real ≥44px (`min-h-11`) tap target (§14.2, §27).
 */
export function MobileNavigation({
  currentUser,
  sessionLoading,
  activeItem,
  showComposeButton,
  onOpenFeed,
  onOpenCast,
  onOpenRooms,
  onOpenSettings,
  onComposeClick,
}: AppNavigationProps) {
  const signedIn = !sessionLoading && currentUser !== null;

  return (
    <>
      {showComposeButton ? (
        <button
          type="button"
          onClick={onComposeClick}
          aria-label="投稿する"
          className="fixed right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-accent-strong text-white shadow-lg transition hover:bg-accent lg:hidden"
          style={{ bottom: "calc(4.5rem + env(safe-area-inset-bottom))" }}
        >
          <Icon name="pencil" className="text-xl" />
        </button>
      ) : null}

      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-canvas/95 backdrop-blur-md lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <MobileNavItem active={activeItem === "feed"} icon="house" label="フィード" onClick={onOpenFeed} />
        {signedIn ? (
          <>
            <MobileNavItem active={activeItem === "cast"} icon="people" label="キャスト" onClick={onOpenCast} />
            <MobileNavItem active={activeItem === "rooms"} icon="chat-square-text" label="ルーム" onClick={onOpenRooms} />
            <MobileNavItem active={false} icon="gear" label="設定" onClick={onOpenSettings} />
          </>
        ) : null}
      </nav>
    </>
  );
}
