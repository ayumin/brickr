import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  ApplicationSettingsResponse,
  EditableApplicationSettingName,
  SaveUserProfileRequest,
  UserProfileDto,
  UserTokenUsageResponse,
} from "@brickr/shared";
import { AvatarUploader } from "../../components/AvatarUploader";
import { ErrorBanner } from "../../components/ErrorBanner";
import { useAuth } from "../auth/AuthContext";
import { api, isAbortError, toErrorMessage } from "../../services/api-client";
import { THEME_OPTIONS, type Theme } from "../../services/theme";

type SettingsSection = "profile" | "appearance" | "my-usage" | "environment" | "models" | "usage";

const PROVIDER_LABELS = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  mock: "Mock",
} as const;

export function UserProfileEditor({
  profile,
  onClose,
  onSaved,
  theme,
  onThemeChange,
  onOpenUsersManagement,
}: {
  profile: UserProfileDto;
  onClose: () => void;
  onSaved: (profile: UserProfileDto) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onOpenUsersManagement: () => void;
}) {
  const navigate = useNavigate();
  const { user, setUser } = useAuth();
  const [section, setSection] = useState<SettingsSection>("profile");
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [description, setDescription] = useState(profile.description);
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(profile.avatarUrl);
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<ApplicationSettingsResponse | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [myUsage, setMyUsage] = useState<UserTokenUsageResponse | null>(null);
  const [loadingMyUsage, setLoadingMyUsage] = useState(false);
  const [myUsageError, setMyUsageError] = useState<string | null>(null);

  const logout = async (): Promise<void> => {
    setLoggingOut(true);
    setError(null);
    try {
      await api.logout();
    } catch (cause) {
      // Idempotent on the backend even without a session; a network failure
      // here still shouldn't trap the user signed in from their own point of
      // view, so the client-side session is cleared regardless.
      console.error(cause);
    }
    setUser(null);
    setLoggingOut(false);
    onClose();
    navigate("/login");
  };

  const isAdmin = user?.isAdmin ?? false;

  useEffect(() => {
    // These panels come from the admin-only /api/application-settings
    // (CLAUDE.md §66.16); a non-admin has no nav entry to reach them, but
    // guard the fetch itself too rather than relying only on hidden UI.
    if (!isAdmin) return;
    if (section !== "environment" && section !== "models" && section !== "usage") return;
    if (settings) return;
    const controller = new AbortController();
    setLoadingSettings(true);
    api.getApplicationSettings(controller.signal)
      .then(setSettings)
      .catch((cause: unknown) => {
        if (!isAbortError(cause)) setError(toErrorMessage(cause));
      })
      .finally(() => setLoadingSettings(false));
    return () => controller.abort();
  }, [section, settings, isAdmin]);

  useEffect(() => {
    if (section !== "my-usage") return;
    if (myUsage) return;
    const controller = new AbortController();
    setLoadingMyUsage(true);
    setMyUsageError(null);
    api.getMyTokenUsage(controller.signal)
      .then(setMyUsage)
      .catch((cause: unknown) => {
        if (!isAbortError(cause)) setMyUsageError(toErrorMessage(cause));
      })
      .finally(() => setLoadingMyUsage(false));
    return () => controller.abort();
  }, [section, myUsage]);

  const submit = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    const request: SaveUserProfileRequest = {
      displayName: displayName.trim(),
      description: description.trim(),
      ...(avatarUrl ? { avatarUrl } : {}),
    };
    try {
      onSaved(await api.updateUserProfile(request));
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/75 p-3 backdrop-blur-sm sm:p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving && !loggingOut) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-settings-title"
        className="mx-auto flex min-h-[36rem] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-line bg-canvas shadow-2xl sm:flex-row"
      >
        <aside className="w-full shrink-0 border-b border-line bg-surface-muted p-3 sm:w-56 sm:border-b-0 sm:border-r sm:p-4">
          <h2 id="user-settings-title" className="px-2 pb-3 text-lg font-bold text-ink">
            設定
          </h2>
          <nav aria-label="設定区分" className="flex gap-1 overflow-x-auto sm:block sm:space-y-1">
            <NavButton active={section === "profile"} onClick={() => setSection("profile")}>プロフィール</NavButton>
            <NavButton active={section === "appearance"} onClick={() => setSection("appearance")}>外観</NavButton>
            {user ? (
              <NavButton active={section === "my-usage"} onClick={() => setSection("my-usage")}>自分の消費トークン</NavButton>
            ) : null}
            {isAdmin ? (
              <div className="min-w-max sm:pt-3">
                <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">環境</p>
                <div className="flex gap-1 sm:block sm:space-y-1">
                  <NavButton nested active={section === "environment"} onClick={() => setSection("environment")}>環境変数</NavButton>
                  <div>
                    <p className="hidden px-5 py-1 text-xs text-ink-faint sm:block">LLM</p>
                    <NavButton nested active={section === "models"} onClick={() => setSection("models")}>プロバイダー / モデル</NavButton>
                    <NavButton nested active={section === "usage"} onClick={() => setSection("usage")}>消費トークン（全体）</NavButton>
                  </div>
                </div>
              </div>
            ) : null}
            {isAdmin ? (
              <div className="min-w-max sm:pt-3">
                <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">管理</p>
                <div className="flex gap-1 sm:block sm:space-y-1">
                  <NavButton nested active={false} onClick={onOpenUsersManagement}>User管理</NavButton>
                </div>
              </div>
            ) : null}
          </nav>

          {user ? (
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
          ) : null}
        </aside>

        <main className="min-w-0 flex-1 p-5 sm:p-7">
          <div className="mb-5 flex items-start gap-3">
            <div>
              <h3 className="text-xl font-bold text-ink">{sectionTitle(section)}</h3>
              <p className="mt-1 text-sm text-ink-muted">{sectionDescription(section)}</p>
            </div>
            <button type="button" onClick={onClose} className="ml-auto rounded-full border border-line px-3 py-1 text-xs text-ink-muted hover:text-ink">閉じる</button>
          </div>

          {error ? <ErrorBanner message="設定を読み込み、または保存できませんでした" detail={error} onDismiss={() => setError(null)} /> : null}

          {section === "profile" ? (
            <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
              <label className="block text-sm text-ink-muted">表示名
                <input value={displayName} required maxLength={80} onChange={(event) => setDisplayName(event.currentTarget.value)} className="mt-1.5 w-full rounded-xl border border-line bg-surface-raised px-3 py-2 text-ink focus:border-accent/60 focus:outline-none" />
              </label>
              <p className="text-xs text-ink-faint">@{profile.handle} は変更できません</p>
              <label className="block text-sm text-ink-muted">プロフィール
                <textarea value={description} maxLength={500} rows={5} onChange={(event) => setDescription(event.currentTarget.value)} className="mt-1.5 w-full resize-y rounded-xl border border-line bg-surface-raised px-3 py-2 text-ink focus:border-accent/60 focus:outline-none" />
              </label>
              <AvatarUploader value={avatarUrl} onChange={setAvatarUrl} />
              <div className="flex justify-end border-t border-line pt-4">
                <button type="submit" disabled={saving || displayName.trim().length === 0} className="rounded-full bg-accent-strong px-5 py-2 text-sm font-semibold text-white hover:bg-accent disabled:opacity-50">{saving ? "保存中…" : "変更を保存"}</button>
              </div>
            </form>
          ) : null}

          {section === "appearance" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {THEME_OPTIONS.map((option) => (
                <button key={option.id} type="button" onClick={() => onThemeChange(option.id)} aria-pressed={theme === option.id} className={`rounded-xl border p-3 text-left text-sm transition ${theme === option.id ? "border-accent bg-accent/10 font-semibold text-accent" : "border-line text-ink-muted hover:border-line-strong hover:text-ink"}`}>
                  <span className="mb-2 flex overflow-hidden rounded-full border border-black/10" aria-hidden="true">{option.swatches.map((color) => <span key={color} className="h-4 flex-1" style={{ backgroundColor: color }} />)}</span>
                  {option.label}
                </button>
              ))}
              <p className="col-span-full text-xs text-ink-faint">テーマの変更はすぐに保存されます。</p>
            </div>
          ) : null}

          {section === "my-usage" ? (
            <MyUsagePanel usage={myUsage} loading={loadingMyUsage} error={myUsageError} />
          ) : null}
          {isAdmin && section === "environment" ? (
            <EnvironmentPanel settings={settings} loading={loadingSettings} onUpdated={setSettings} />
          ) : null}
          {isAdmin && section === "models" ? <ModelsPanel settings={settings} loading={loadingSettings} /> : null}
          {isAdmin && section === "usage" ? <UsagePanel settings={settings} loading={loadingSettings} /> : null}
        </main>
      </div>
    </div>
  );
}

function NavButton({ active, nested = false, onClick, children }: { active: boolean; nested?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} aria-current={active ? "page" : undefined} className={`block min-w-max rounded-lg py-2 text-left text-sm transition sm:w-full ${nested ? "px-5" : "px-3"} ${active ? "bg-accent/15 font-semibold text-accent" : "text-ink-muted hover:bg-surface-raised hover:text-ink"}`}>{children}</button>;
}

function EnvironmentPanel({ settings, loading, onUpdated }: SettingsPanelProps & { onUpdated: (settings: ApplicationSettingsResponse) => void }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    setDraft(Object.fromEntries(settings.environment.map((item) => [item.name, item.value])));
  }, [settings]);

  if (loading || !settings) return <Loading />;

  const changed = settings.environment.filter(
    (item) => item.editable && draft[item.name] !== undefined && draft[item.name] !== item.value,
  );
  const validationError = validateEnvironmentDraft(draft);

  const save = async (): Promise<void> => {
    const overrides = Object.fromEntries(
      changed.map((item) => [item.name, draft[item.name] ?? item.value]),
    ) as Partial<Record<EditableApplicationSettingName, string>>;
    setSaving(true);
    setError(null);
    try {
      onUpdated(await api.updateApplicationSettings({ overrides }));
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const reset = async (name: EditableApplicationSettingName): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      onUpdated(await api.updateApplicationSettings({ overrides: { [name]: null } }));
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {error ? <ErrorBanner message="環境設定を保存できませんでした" detail={error} onDismiss={() => setError(null)} /> : null}
      <div className="overflow-hidden rounded-xl border border-line">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-muted text-ink-muted">
            <tr><th className="px-4 py-3">変数</th><th className="px-4 py-3">現在値</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {settings.environment.map((item) => (
              <tr key={item.name}>
                <td className="w-1/2 px-4 py-3 align-top">
                  <span className="block font-mono text-xs text-ink">{item.name}</span>
                  <span className="mt-1 block text-xs font-normal leading-relaxed text-ink-faint">{item.description}</span>
                  {item.source === "override" ? (
                    <span className="mt-1.5 inline-block rounded-full bg-accent/15 px-2 py-0.5 text-[10px] text-accent">
                      画面設定
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 align-top">
                  {item.inputType === "toggle" ? (
                    <span className="inline-flex items-center gap-2 text-xs text-ink-muted">
                      <span role="switch" aria-checked={item.value === "ON"} aria-disabled="true" className={`relative h-5 w-9 rounded-full ${item.value === "ON" ? "bg-accent" : "bg-line-strong"}`}>
                        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${item.value === "ON" ? "left-[18px]" : "left-0.5"}`} />
                      </span>
                      {item.value}
                    </span>
                  ) : item.editable ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        inputMode={item.inputType === "number" ? "numeric" : undefined}
                        value={draft[item.name] ?? item.value}
                        disabled={saving}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setDraft((current) => ({ ...current, [item.name]: value }));
                        }}
                        className="min-w-44 flex-1 rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink focus:border-accent/60 focus:outline-none"
                      />
                      {item.source === "override" ? (
                        <button type="button" disabled={saving} onClick={() => void reset(item.name as EditableApplicationSettingName)} className="rounded-full border border-line px-3 py-1.5 text-xs text-ink-muted hover:text-ink disabled:opacity-50">
                          環境変数に戻す
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <span className="break-all text-ink-muted">{item.value}{item.secret ? <span className="ml-2 text-xs text-ink-faint">値は非表示</span> : null}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-xs text-danger">{validationError}</p>
        <button type="button" disabled={saving || changed.length === 0 || validationError !== null} onClick={() => void save()} className="ml-auto rounded-full bg-accent-strong px-5 py-2 text-sm font-semibold text-white hover:bg-accent disabled:opacity-50">
          {saving ? "保存中…" : "変更を保存"}
        </button>
      </div>
    </div>
  );
}

function ModelsPanel({ settings, loading }: SettingsPanelProps) {
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  if (loading || !settings) return <Loading />;
  const effectiveProviderId =
    selectedProviderId ??
    settings.llm.providers.find((provider) => provider.available)?.providerId ??
    settings.llm.providers[0]?.providerId ??
    null;
  const models = settings.llm.models.filter(
    (model) => model.providerId === effectiveProviderId,
  );

  return (
    <div className="space-y-5">
      <div>
        <h4 className="mb-2 font-semibold text-ink">プロバイダーを選択</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          {settings.llm.providers.map((provider) => {
            const selected = provider.providerId === effectiveProviderId;
            return (
              <button
                key={provider.providerId}
                type="button"
                aria-pressed={selected}
                onClick={() => setSelectedProviderId(provider.providerId)}
                className={`rounded-xl border p-4 text-left transition ${
                  selected
                    ? "border-accent bg-accent/10"
                    : "border-line bg-surface-raised hover:border-line-strong"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-semibold ${selected ? "text-accent" : "text-ink"}`}>
                    {providerLabel(provider.providerId)}
                  </span>
                  <span className={`rounded-full px-2 py-1 text-xs ${provider.available ? "bg-accent/15 text-accent" : "bg-surface-muted text-ink-faint"}`}>
                    {provider.available ? "利用可能" : "未設定"}
                  </span>
                </div>
                <span className="mt-2 block break-all text-xs text-ink-muted">
                  既定: {provider.defaultModel}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h4 className="mb-2 font-semibold text-ink">
          {effectiveProviderId ? providerLabel(effectiveProviderId) : "モデル"}のモデル ({models.length})
        </h4>
        <div className="max-h-64 overflow-auto rounded-xl border border-line">
          <table className="w-full border-separate border-spacing-0 text-left text-sm">
            <thead className="bg-surface-muted text-ink-muted">
              <tr>
                <th className="border-b border-line px-4 py-3">プロバイダー</th>
                <th className="border-b border-line px-4 py-3">モデル</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {models.map((model) => (
                <tr key={model.id}>
                  <td className="px-4 py-3">{providerLabel(model.providerId)}</td>
                  <td className="break-all px-4 py-3 text-ink-muted">{model.model}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {models.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-muted">
              保存されているモデルはありません。
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MyUsagePanel({
  usage,
  loading,
  error,
}: {
  usage: UserTokenUsageResponse | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return <p className="py-12 text-center text-sm text-ink-muted">消費トークンを読み込んでいます…</p>;
  }
  if (error) {
    return <ErrorBanner message="消費トークンを取得できませんでした" detail={error} />;
  }
  if (!usage) return null;
  return (
    <div className="grid grid-cols-3 gap-3">
      <Metric label="入力" value={usage.totalInputTokens} />
      <Metric label="出力" value={usage.totalOutputTokens} />
      <Metric label="合計" value={usage.totalTokens} />
    </div>
  );
}

function UsagePanel({ settings, loading }: SettingsPanelProps) {
  if (loading || !settings) return <Loading />;
  const totals = settings.llm.usage.entries.reduce((sum, entry) => ({ requests: sum.requests + entry.requestCount, input: sum.input + entry.inputTokens, output: sum.output + entry.outputTokens, total: sum.total + entry.totalTokens }), { requests: 0, input: 0, output: 0, total: 0 });
  const estimatedCostUsd = settings.llm.usage.entries.reduce(
    (sum, entry) => sum + (entry.estimatedCostUsd ?? 0),
    0,
  );
  const hasUnpricedUsage = settings.llm.usage.entries.some(
    (entry) => entry.totalTokens > 0 && entry.estimatedCostUsd === null,
  );
  const costDetail = `概算 ${formatUsd(estimatedCostUsd)}${hasUnpricedUsage ? "（一部未算定）" : ""}`;
  return <div className="space-y-4"><p className="text-xs text-ink-faint">集計開始: {new Date(settings.llm.usage.trackedSince).toLocaleString("ja-JP")}（バックエンド再起動時にリセット）</p><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="リクエスト" value={totals.requests} /><Metric label="入力" value={totals.input} /><Metric label="出力" value={totals.output} /><Metric label="合計" value={totals.total} detail={costDetail} /></div>{settings.llm.usage.entries.length === 0 ? <p className="rounded-xl border border-line bg-surface-muted p-5 text-sm text-ink-muted">まだLLMの利用記録はありません。</p> : <div className="overflow-auto rounded-xl border border-line"><table className="w-full text-left text-sm"><thead className="bg-surface-muted text-ink-muted"><tr><th className="px-3 py-3">プロバイダー / モデル</th><th className="px-3 py-3 text-right">回数</th><th className="px-3 py-3 text-right">入力</th><th className="px-3 py-3 text-right">出力</th><th className="px-3 py-3 text-right">合計</th></tr></thead><tbody className="divide-y divide-line">{settings.llm.usage.entries.map((entry) => <tr key={`${entry.providerId}:${entry.model}`}><td className="px-3 py-3 text-ink"><span className="block">{providerLabel(entry.providerId)}</span><span className="block max-w-64 truncate text-xs text-ink-faint">{entry.model}</span></td>{[entry.requestCount, entry.inputTokens, entry.outputTokens, entry.totalTokens].map((value, index) => <td key={index} className="px-3 py-3 text-right tabular-nums text-ink-muted">{value.toLocaleString("ja-JP")}</td>)}</tr>)}</tbody></table></div>}</div>;
}

function Metric({ label, value, detail }: { label: string; value: number; detail?: string }) { return <div className="rounded-xl border border-line bg-surface-raised p-3"><p className="text-xs text-ink-faint">{label}</p><p className="mt-1 text-lg font-bold tabular-nums text-ink">{value.toLocaleString("ja-JP")}</p>{detail ? <p className="mt-0.5 text-[11px] tabular-nums text-ink-faint">{detail}</p> : null}</div>; }
function formatUsd(value: number): string { return `$${value.toFixed(value >= 1 ? 4 : 6)}`; }
function Loading() { return <p className="py-12 text-center text-sm text-ink-muted">設定を読み込んでいます…</p>; }
function providerLabel(providerId: string): string { return PROVIDER_LABELS[providerId as keyof typeof PROVIDER_LABELS] ?? providerId; }
function validateEnvironmentDraft(draft: Record<string, string>): string | null {
  for (const name of ["OPENAI_MODEL", "ANTHROPIC_MODEL", "GEMINI_MODEL"]) {
    const value = draft[name]?.trim() ?? "";
    if (value.length === 0 || value.length > 200) return `${name}は1〜200文字で入力してください。`;
  }
  const limits: Record<string, [number, number]> = {
    LLM_TIMEOUT_MS: [1_000, 300_000],
    LLM_MAX_RETRIES: [0, 2],
    MIN_RESPONDERS: [0, 100],
    MAX_RESPONDERS: [1, 100],
    CONTEXT_POST_LIMIT: [1, 200],
    MAX_CONCURRENT_CHARACTERS: [1, 100],
    MAX_CASCADE_DEPTH: [0, 20],
  };
  for (const [name, [minimum, maximum]] of Object.entries(limits)) {
    const value = Number(draft[name]);
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      return `${name}は${String(minimum)}〜${String(maximum)}の整数で入力してください。`;
    }
  }
  if (Number(draft.MIN_RESPONDERS) > Number(draft.MAX_RESPONDERS)) {
    return "MIN_RESPONDERSはMAX_RESPONDERS以下にしてください。";
  }
  return null;
}
type SettingsPanelProps = { settings: ApplicationSettingsResponse | null; loading: boolean };
function sectionTitle(section: SettingsSection): string { return ({ profile: "プロフィール", appearance: "外観", "my-usage": "自分の消費トークン", environment: "環境変数", models: "プロバイダー / モデル", usage: "消費トークン（全体）" })[section]; }
function sectionDescription(section: SettingsSection): string { return ({ profile: "表示名、プロフィール、アバターを編集します。", appearance: "Brickrの表示テーマを選択します。", "my-usage": "あなたの投稿がきっかけで生成されたLLMのトークン利用量です。", environment: "編集可能な値は画面設定で上書きできます。その他は環境変数の現在値を表示します。", models: "利用可能なLLMプロバイダーとモデルを確認します。", usage: "このプロセスで記録された、全User分のLLMトークン利用量です。" })[section]; }
