import { useEffect, useState } from "react";
import type { UserTokenUsageResponse } from "@brickr/shared";

import { ErrorBanner } from "../../components/ErrorBanner";
import { api, isAbortError, toErrorMessage } from "../../services/api-client";

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line bg-surface-raised p-3">
      <p className="text-xs text-ink-faint">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums text-ink">{value.toLocaleString("ja-JP")}</p>
    </div>
  );
}

/**
 * `/settings/usage` (§22): the signed-in user's own token usage, i.e. the
 * LLM tokens spent generating cast responses to posts they authored (§66.4).
 */
export function UsageSettings() {
  const [usage, setUsage] = useState<UserTokenUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api
      .getMyTokenUsage(controller.signal)
      .then(setUsage)
      .catch((cause: unknown) => {
        if (!isAbortError(cause)) setError(toErrorMessage(cause));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

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
