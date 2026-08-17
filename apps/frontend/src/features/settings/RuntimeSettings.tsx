import { useEffect, useState } from "react";
import type { ApplicationSettingsResponse, EditableApplicationSettingName } from "@brickr/shared";

import { ErrorBanner } from "../../components/ErrorBanner";
import { api, isAbortError, toErrorMessage } from "../../services/api-client";

const PROVIDER_LABELS = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  mock: "Mock",
} as const;

type RuntimeTab = "environment" | "models" | "usage";

const RUNTIME_TABS: Array<{ key: RuntimeTab; label: string }> = [
  { key: "environment", label: "環境変数" },
  { key: "models", label: "プロバイダー / モデル" },
  { key: "usage", label: "トークン利用量（全体）" },
];

/**
 * `/settings/runtime` (§22 "モデルと実行設定", admin-only, CLAUDE.md §66.16):
 * environment overrides, available LLM providers/models, and org-wide token
 * usage. Kept as one section with internal tabs (unchanged from the old
 * `UserProfileEditor`'s "環境" group) rather than three separate URLs - §22
 * lists this as a single settings-nav entry.
 */
export function RuntimeSettings() {
  const [tab, setTab] = useState<RuntimeTab>("environment");
  const [settings, setSettings] = useState<ApplicationSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api
      .getApplicationSettings(controller.signal)
      .then(setSettings)
      .catch((cause: unknown) => {
        if (!isAbortError(cause)) setError(toErrorMessage(cause));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  return (
    <div>
      <nav aria-label="モデルと実行設定の区分" className="mb-5 flex gap-1 border-b border-line">
        {RUNTIME_TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-current={tab === item.key ? "page" : undefined}
            onClick={() => setTab(item.key)}
            className={`rounded-t-lg px-3 py-2 text-sm transition ${
              tab === item.key
                ? "border-b-2 border-accent font-semibold text-accent"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {error ? (
        <ErrorBanner message="設定を読み込み、または保存できませんでした" detail={error} onDismiss={() => setError(null)} />
      ) : null}

      {tab === "environment" ? (
        <EnvironmentPanel settings={settings} loading={loading} onUpdated={setSettings} />
      ) : null}
      {tab === "models" ? <ModelsPanel settings={settings} loading={loading} /> : null}
      {tab === "usage" ? <UsagePanel settings={settings} loading={loading} /> : null}
    </div>
  );
}

type SettingsPanelProps = { settings: ApplicationSettingsResponse | null; loading: boolean };

function Loading() {
  return <p className="py-12 text-center text-sm text-ink-muted">設定を読み込んでいます…</p>;
}

function providerLabel(providerId: string): string {
  return PROVIDER_LABELS[providerId as keyof typeof PROVIDER_LABELS] ?? providerId;
}

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

function EnvironmentPanel({
  settings,
  loading,
  onUpdated,
}: SettingsPanelProps & { onUpdated: (settings: ApplicationSettingsResponse) => void }) {
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
          <thead className="bg-surface-raised text-ink-muted">
            <tr>
              <th className="px-4 py-3">変数</th>
              <th className="px-4 py-3">現在値</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {settings.environment.map((item) => (
              <tr key={item.name}>
                <td className="w-1/2 px-4 py-3 align-top">
                  <span className="block font-mono text-xs text-ink">{item.name}</span>
                  <span className="mt-1 block text-xs font-normal leading-relaxed text-ink-faint">
                    {item.description}
                  </span>
                  {item.source === "override" ? (
                    <span className="mt-1.5 inline-block rounded-full bg-accent/15 px-2 py-0.5 text-[10px] text-accent">
                      画面設定
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 align-top">
                  {item.inputType === "toggle" ? (
                    <span className="inline-flex items-center gap-2 text-xs text-ink-muted">
                      <span
                        role="switch"
                        aria-checked={item.value === "ON"}
                        aria-disabled="true"
                        className={`relative h-5 w-9 rounded-full ${item.value === "ON" ? "bg-accent" : "bg-line-strong"}`}
                      >
                        <span
                          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${item.value === "ON" ? "left-[18px]" : "left-0.5"}`}
                        />
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
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void reset(item.name as EditableApplicationSettingName)}
                          className="rounded-full border border-line px-3 py-1.5 text-xs text-ink-muted hover:text-ink disabled:opacity-50"
                        >
                          環境変数に戻す
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <span className="break-all text-ink-muted">
                      {item.value}
                      {item.secret ? <span className="ml-2 text-xs text-ink-faint">値は非表示</span> : null}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-xs text-danger">{validationError}</p>
        <button
          type="button"
          disabled={saving || changed.length === 0 || validationError !== null}
          onClick={() => void save()}
          className="ml-auto rounded-full bg-accent-strong px-5 py-2 text-sm font-semibold text-white hover:bg-accent disabled:opacity-50"
        >
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
  const models = settings.llm.models.filter((model) => model.providerId === effectiveProviderId);

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
                  selected ? "border-accent bg-accent/10" : "border-line bg-surface-raised hover:border-line-strong"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-semibold ${selected ? "text-accent" : "text-ink"}`}>
                    {providerLabel(provider.providerId)}
                  </span>
                  <span
                    className={`rounded-full px-2 py-1 text-xs ${provider.available ? "bg-accent/15 text-accent" : "bg-surface-raised text-ink-faint"}`}
                  >
                    {provider.available ? "利用可能" : "未設定"}
                  </span>
                </div>
                <span className="mt-2 block break-all text-xs text-ink-muted">既定: {provider.defaultModel}</span>
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
            <thead className="bg-surface-raised text-ink-muted">
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
            <p className="px-4 py-6 text-center text-sm text-ink-muted">保存されているモデルはありません。</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function UsagePanel({ settings, loading }: SettingsPanelProps) {
  if (loading || !settings) return <Loading />;
  const totals = settings.llm.usage.entries.reduce(
    (sum, entry) => ({
      requests: sum.requests + entry.requestCount,
      input: sum.input + entry.inputTokens,
      output: sum.output + entry.outputTokens,
      total: sum.total + entry.totalTokens,
    }),
    { requests: 0, input: 0, output: 0, total: 0 },
  );
  const estimatedCostUsd = settings.llm.usage.entries.reduce((sum, entry) => sum + (entry.estimatedCostUsd ?? 0), 0);
  const hasUnpricedUsage = settings.llm.usage.entries.some(
    (entry) => entry.totalTokens > 0 && entry.estimatedCostUsd === null,
  );
  const costDetail = `概算 ${formatUsd(estimatedCostUsd)}${hasUnpricedUsage ? "（一部未算定）" : ""}`;
  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-faint">
        集計開始: {new Date(settings.llm.usage.trackedSince).toLocaleString("ja-JP")}（バックエンド再起動時にリセット）
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <UsageMetric label="リクエスト" value={totals.requests} />
        <UsageMetric label="入力" value={totals.input} />
        <UsageMetric label="出力" value={totals.output} />
        <UsageMetric label="合計" value={totals.total} detail={costDetail} />
      </div>
      {settings.llm.usage.entries.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface-raised p-5 text-sm text-ink-muted">
          まだLLMの利用記録はありません。
        </p>
      ) : (
        <div className="overflow-auto rounded-xl border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-raised text-ink-muted">
              <tr>
                <th className="px-3 py-3">プロバイダー / モデル</th>
                <th className="px-3 py-3 text-right">回数</th>
                <th className="px-3 py-3 text-right">入力</th>
                <th className="px-3 py-3 text-right">出力</th>
                <th className="px-3 py-3 text-right">合計</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {settings.llm.usage.entries.map((entry) => (
                <tr key={`${entry.providerId}:${entry.model}`}>
                  <td className="px-3 py-3 text-ink">
                    <span className="block">{providerLabel(entry.providerId)}</span>
                    <span className="block max-w-64 truncate text-xs text-ink-faint">{entry.model}</span>
                  </td>
                  {[entry.requestCount, entry.inputTokens, entry.outputTokens, entry.totalTokens].map((value, index) => (
                    <td key={index} className="px-3 py-3 text-right tabular-nums text-ink-muted">
                      {value.toLocaleString("ja-JP")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function UsageMetric({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-raised p-3">
      <p className="text-xs text-ink-faint">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums text-ink">{value.toLocaleString("ja-JP")}</p>
      {detail ? <p className="mt-0.5 text-[11px] tabular-nums text-ink-faint">{detail}</p> : null}
    </div>
  );
}

function formatUsd(value: number): string {
  return `$${value.toFixed(value >= 1 ? 4 : 6)}`;
}
