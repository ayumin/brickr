import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { UserProfileDto } from "@brickr/shared";

import { isSettingsSection, roomPath, settingsPath, type SettingsSection as UrlSettingsSection } from "../../routes";
import { readSelectedRoomId } from "../rooms/selected-room-storage";
import { applyTheme, readPreferredTheme, type Theme } from "../../services/theme";
import { UserManagementList } from "../admin/UserManagementList";
import { UserProfileEditor } from "../user/UserProfileEditor";
import { useUserProfile } from "../../hooks/useUserProfile";

/**
 * Maps a URL section (`routes.ts`'s `SettingsSection`) to the internal
 * section `UserProfileEditor` already understands. `/settings/runtime`
 * lands on its "environment" tab; the admin can still reach the models/usage
 * tabs from UserProfileEditor's own sub-nav without the URL changing -
 * splitting those into their own addressable routes is Step 10's job.
 */
function toEditorSection(section: UrlSettingsSection): "profile" | "appearance" | "my-usage" | "environment" {
  if (section === "usage") return "my-usage";
  if (section === "runtime") return "environment";
  if (section === "appearance") return "appearance";
  return "profile";
}

/**
 * The route-driven settings screen (§22, Issue #48 "settings shell切替").
 *
 * Wraps the existing UserProfileEditor (in `variant="page"`, dropping its
 * modal chrome) rather than splitting every section into its own component -
 * that finer breakdown is Step 10's "route settings sections" work item.
 * `/settings/users` and `/settings/invites` bypass it entirely and render
 * the existing UserManagementList directly, since user/invite management
 * was never part of UserProfileEditor's own tab set.
 *
 * AppShell (§13.5) does not render the normal nav while a `/settings/*`
 * route is active - UserProfileEditor's own section sidebar already serves
 * as the replacement nav §22 calls for, so this component adds no nav of
 * its own beyond "設定を閉じる" for the admin-only screens.
 */
export function SettingsShell({ onProfileUpdated }: { onProfileUpdated?: (profile: UserProfileDto) => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ section: string }>();
  const userProfile = useUserProfile();
  const [theme, setTheme] = useState<Theme>(readPreferredTheme);

  const close = (): void => {
    const state = location.state as { returnTo?: string } | null;
    if (state?.returnTo) {
      navigate(state.returnTo, { replace: true });
      return;
    }
    const storedRoomId = readSelectedRoomId();
    navigate(storedRoomId ? roomPath(storedRoomId) : "/", { replace: true });
  };

  const section = params.section && isSettingsSection(params.section) ? params.section : "profile";

  if (section === "users" || section === "invites") {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-4">
        <button
          type="button"
          onClick={close}
          className="mb-4 rounded-full border border-line px-3 py-1 text-xs text-ink-muted hover:text-ink"
        >
          設定を閉じる
        </button>
        <UserManagementList />
      </div>
    );
  }

  return (
    <UserProfileEditor
      variant="page"
      initialSection={toEditorSection(section)}
      profile={userProfile.profile}
      theme={theme}
      onThemeChange={(selected) => {
        applyTheme(selected);
        setTheme(selected);
      }}
      onClose={close}
      onSaved={(saved) => {
        userProfile.setProfile(saved);
        onProfileUpdated?.(saved);
      }}
      onOpenUsersManagement={() => navigate(settingsPath("users"))}
    />
  );
}
