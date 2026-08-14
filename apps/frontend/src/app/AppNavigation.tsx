import type { AuthUserDto } from "@brickr/shared";
import { Avatar } from "../components/Avatar";
import { Icon, type IconName } from "../components/Icon";
import { APP_NAME } from "../brand";
import { BrandLogo } from "../components/BrandLogo";

export type NavActiveItem = "feed" | "cast" | "rooms" | "other";

export type AppNavigationProps = {
  currentUser: AuthUserDto | null;
  /** True only until the initial session check resolves (§13.3) - never after. */
  sessionLoading: boolean;
  activeItem: NavActiveItem;
  /** True only on the feed and an open room (§14.1) - never on the cast/room lists. */
  showComposeButton: boolean;
  onOpenFeed: () => void;
  onOpenCast: () => void;
  onOpenRooms: () => void;
  onOpenSettings: () => void;
  onComposeClick: () => void;
};

function NavItem({
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
      className={`flex w-full items-center gap-3 rounded-full px-3 py-2.5 text-sm font-medium transition ${
        active ? "bg-accent/15 text-accent" : "text-ink-muted hover:bg-surface-hover hover:text-ink"
      }`}
    >
      <Icon name={icon} className="text-lg" />
      {label}
    </button>
  );
}

/**
 * Desktop left navigation (§14.1), ~196px, sticky.
 *
 * Every item that depends on being signed in is simply absent from the DOM
 * when `currentUser` is null or while `sessionLoading` - never rendered
 * disabled (§27): a screen reader or a sighted user scanning the rail sees
 * only the destinations actually reachable right now.
 */
export function AppNavigation({
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
    <nav className="sticky top-0 hidden h-dvh w-[196px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-line px-2 py-4 lg:flex">
      <button
        type="button"
        onClick={onOpenFeed}
        className="mb-3 flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:opacity-80"
      >
        <BrandLogo className="h-7 w-7" />
        <span className="font-display text-sm font-bold text-ink">{APP_NAME}</span>
      </button>

      <NavItem active={activeItem === "feed"} icon="house" label="フィード" onClick={onOpenFeed} />

      {signedIn ? (
        <>
          <NavItem active={activeItem === "cast"} icon="people" label="キャスト" onClick={onOpenCast} />
          <NavItem active={activeItem === "rooms"} icon="chat-square-text" label="ルーム" onClick={onOpenRooms} />
        </>
      ) : null}

      {showComposeButton ? (
        <button
          type="button"
          onClick={onComposeClick}
          className="mt-2 w-full rounded-full bg-accent-strong px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent"
        >
          <Icon name="pencil" className="mr-1.5" />
          投稿する
        </button>
      ) : null}

      <div className="grow" />

      {signedIn && currentUser ? (
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex items-center gap-2 rounded-full px-2 py-2 text-left transition hover:bg-surface-hover"
        >
          <Avatar handle={currentUser.handle} displayName={currentUser.displayName} avatarUrl={currentUser.avatarUrl} size="sm" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-ink">{currentUser.displayName}</span>
            <span className="block truncate text-xs text-ink-faint">@{currentUser.handle}</span>
          </span>
        </button>
      ) : null}
    </nav>
  );
}
