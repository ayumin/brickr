import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { UserProfileDto } from "@brickr/shared";

import { Icon } from "../../components/Icon";
import { isSettingsSection, roomPath, type SettingsSection } from "../../routes";
import { checkAdminSettingsAccess } from "../../app/route-access";
import { readSelectedRoomId } from "../rooms/selected-room-storage";
import { applyTheme, readPreferredTheme, type Theme } from "../../services/theme";
import { useAuth } from "../auth/AuthContext";
import { useUserProfile } from "../../hooks/useUserProfile";
import { AppearanceSettings } from "./AppearanceSettings";
import { InviteSettings } from "./InviteSettings";
import { ProfileSettings } from "./ProfileSettings";
import { RuntimeSettings } from "./RuntimeSettings";
import { SettingsNav } from "./SettingsNav";
import { UsageSettings } from "./UsageSettings";
import { UserManagementSettings } from "./UserManagementSettings";

const SECTION_TITLES: Record<SettingsSection, string> = {
  profile: "プロフィール",
  appearance: "見た目",
  usage: "使用量",
  runtime: "モデルと実行設定",
  users: "ユーザー管理",
  invites: "招待コード",
};

const SECTION_DESCRIPTIONS: Record<SettingsSection, string> = {
  profile: "表示名、プロフィール、アバターを編集します。",
  appearance: "Brickrの表示テーマを選択します。",
  usage: "あなたの投稿がきっかけで生成されたLLMのトークン利用量です。",
  runtime: "環境変数、LLMプロバイダー・モデル、全User分のトークン利用量を確認・編集します。",
  users: "Userの停止・復帰・仮パスワード発行や、作成したキャスト・トークン利用量を確認します。",
  invites: "新規登録用の招待コードを発行します。",
};

/**
 * The route-driven settings screen (§22). Replaces the old modal
 * `UserProfileEditor`, decomposed into one component per URL section so each
 * is directly addressable and all six share the same `SettingsNav` - not
 * just the four that used to delegate to `UserProfileEditor`'s own sidebar
 * (`/settings/users` and `/settings/invites` previously rendered nothing but
 * a bare close button, a dead end with no way to reach another section or
 * log out without the browser back button).
 *
 * AppShell (§13.5) does not render the normal nav while a `/settings/*`
 * route is active; `SettingsNav` is the replacement §22 calls for.
 */
export function SettingsShell({ onProfileUpdated }: { onProfileUpdated?: (profile: UserProfileDto) => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ section: string }>();
  const userProfile = useUserProfile();
  const profileLoaded = !userProfile.loading && userProfile.profile.id !== "";
  const [theme, setTheme] = useState<Theme>(readPreferredTheme);
  const { user } = useAuth();

  const section: SettingsSection = params.section && isSettingsSection(params.section) ? params.section : "profile";

  const accessDecision = checkAdminSettingsAccess(section, user);
  useEffect(() => {
    if (!accessDecision.allowed) {
      navigate(accessDecision.redirectTo, { replace: true });
    }
  }, [accessDecision.allowed, navigate]);

  const close = (): void => {
    const state = location.state as { returnTo?: string } | null;
    if (state?.returnTo) {
      navigate(state.returnTo, { replace: true });
      return;
    }
    const storedRoomId = readSelectedRoomId();
    navigate(storedRoomId ? roomPath(storedRoomId) : "/", { replace: true });
  };

  if (!accessDecision.allowed) return null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col">
      <div className="border-b border-line px-4 py-3 sm:px-0">
        <button
          type="button"
          onClick={close}
          className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink-muted transition hover:text-ink"
        >
          <Icon name="arrow-left" />
          設定を閉じる
        </button>
      </div>

      <div className="flex flex-col sm:flex-row">
        <SettingsNav activeSection={section} isAdmin={user?.isAdmin ?? false} />

        <main className="min-w-0 flex-1 p-5 sm:p-7">
          <div className="mb-5">
            <h1 className="text-xl font-bold text-ink">{SECTION_TITLES[section]}</h1>
            <p className="mt-1 text-sm text-ink-muted">{SECTION_DESCRIPTIONS[section]}</p>
          </div>

          {section === "profile" ? (
            profileLoaded ? (
              <ProfileSettings
                profile={userProfile.profile}
                onSaved={(saved) => {
                  userProfile.setProfile(saved);
                  onProfileUpdated?.(saved);
                }}
              />
            ) : (
              <div className="flex items-center justify-center py-12 text-sm text-ink-muted">
                読み込み中…
              </div>
            )
          ) : null}
          {section === "appearance" ? (
            <AppearanceSettings
              theme={theme}
              onThemeChange={(selected) => {
                applyTheme(selected);
                setTheme(selected);
              }}
            />
          ) : null}
          {section === "usage" ? <UsageSettings /> : null}
          {section === "runtime" ? <RuntimeSettings /> : null}
          {section === "users" ? <UserManagementSettings /> : null}
          {section === "invites" ? <InviteSettings /> : null}
        </main>
      </div>
    </div>
  );
}
