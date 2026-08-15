import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { settingsPath, type SettingsSection } from "../../routes";
import { useAuth } from "../auth/AuthContext";
import { api } from "../../services/api-client";

type NavItem = { section: SettingsSection; label: string };

const USER_ITEMS: NavItem[] = [
  { section: "profile", label: "プロフィール" },
  { section: "appearance", label: "見た目" },
  { section: "usage", label: "使用量" },
];

const ADMIN_ITEMS: NavItem[] = [
  { section: "runtime", label: "モデルと実行設定" },
  { section: "users", label: "ユーザー管理" },
  { section: "invites", label: "招待コード" },
];

/**
 * The settings sidebar (§22), shown for all six `/settings/:section` routes -
 * including `/settings/users` and `/settings/invites`, which previously had
 * no nav of their own and no way back to the other sections without the
 * browser back button. Navigation is URL-driven (`settingsPath`), not local
 * state, so the active item always matches the current route.
 */
export function SettingsNav({
  activeSection,
  isAdmin,
}: {
  activeSection: SettingsSection;
  isAdmin: boolean;
}) {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  const logout = async (): Promise<void> => {
    setLoggingOut(true);
    try {
      await api.logout();
    } catch (cause) {
      // Idempotent on the backend even without a session; a network failure
      // here still shouldn't trap the user signed in from their own point of
      // view, so the client-side session is cleared regardless (§22).
      console.error(cause);
    }
    setUser(null);
    // Not `/login` (§22): browsing stays available signed out, and the
    // selected-room localStorage entry is deliberately left untouched so it
    // can still be restored after a future login.
    navigate("/", { replace: true });
  };

  return (
    <aside className="w-full shrink-0 border-b border-line bg-surface-muted p-3 sm:w-56 sm:border-b-0 sm:border-r sm:p-4">
      <nav aria-label="設定区分" className="flex gap-1 overflow-x-auto sm:block sm:space-y-1">
        {USER_ITEMS.map((item) => (
          <NavButton
            key={item.section}
            active={activeSection === item.section}
            onClick={() => navigate(settingsPath(item.section))}
          >
            {item.label}
          </NavButton>
        ))}
        {isAdmin ? (
          <div className="min-w-max sm:pt-3">
            <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">管理者</p>
            <div className="flex gap-1 sm:block sm:space-y-1">
              {ADMIN_ITEMS.map((item) => (
                <NavButton
                  key={item.section}
                  active={activeSection === item.section}
                  onClick={() => navigate(settingsPath(item.section))}
                >
                  {item.label}
                </NavButton>
              ))}
            </div>
          </div>
        ) : null}
      </nav>

      <div className="mt-4 border-t border-line pt-3 sm:mt-6">
        <button
          type="button"
          disabled={loggingOut}
          onClick={() => {
            void logout();
          }}
          className="w-full rounded-lg px-3 py-2 text-left text-sm text-danger transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loggingOut ? "ログアウト中…" : "ログアウト"}
        </button>
      </div>
    </aside>
  );
}

function NavButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`block min-w-max rounded-lg px-3 py-2 text-left text-sm transition sm:w-full ${
        active ? "bg-accent/15 font-semibold text-accent" : "text-ink-muted hover:bg-surface-raised hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
