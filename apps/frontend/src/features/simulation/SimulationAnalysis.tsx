import { useEffect, useState } from "react";
import type { SimulationAnalysisDto } from "@enjo/shared";

import { Avatar } from "../../components/Avatar";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Icon } from "../../components/Icon";
import { Spinner } from "../../components/Spinner";
import { api, isAbortError, toErrorMessage } from "../../services/api-client";

export function SimulationAnalysis({ simulationId }: { simulationId: string }) {
  const [analysis, setAnalysis] = useState<SimulationAnalysisDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    void api
      .getSimulationAnalysis(simulationId, controller.signal)
      .then(setAnalysis)
      .catch((cause: unknown) => {
        if (!isAbortError(cause)) setError(toErrorMessage(cause));
      });
    return () => controller.abort();
  }, [reloadToken, simulationId]);

  if (error) {
    return <div className="p-4"><ErrorBanner message="分析結果を取得できませんでした" detail={error} onRetry={() => setReloadToken((value) => value + 1)} /></div>;
  }
  if (!analysis) {
    return <div className="flex justify-center py-20"><Spinner label="投稿内容を分析しています…" /></div>;
  }

  const metrics = [
    { label: "投稿数", value: analysis.postCount, icon: "pencil" as const },
    { label: "投稿者数", value: analysis.authorCount, icon: "people" as const },
    { label: "返信数", value: analysis.replyCount, icon: "arrow-left" as const },
    { label: "リポスト数", value: analysis.repostCount, icon: "repeat" as const },
  ];

  return (
    <section className="p-4 sm:p-6">
      <div className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-sm font-bold text-ink">投稿内容の要約</h2>
        <dl className="mt-4 space-y-4">
          {[
            ["このシミュレーション全体で何が話題となったのか？", analysis.summary.overallTopics],
            ["どのような投稿があったか？", analysis.summary.postOverview],
            ["大きな反響を得たのはどんな話題か？", analysis.summary.highEngagementTopics],
            ["反響が少なかったのはどんな話題か？", analysis.summary.lowEngagementTopics],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-semibold text-ink">{label}</dt>
              <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink-muted">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-2xl border border-line bg-surface p-4 text-center">
            <Icon name={metric.icon} className="text-ink-faint" />
            <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{metric.value.toLocaleString("ja-JP")}</p>
            <p className="text-xs text-ink-muted">{metric.label}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-surface">
        <header className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-bold text-ink">投稿者ランキング</h2>
          <p className="mt-0.5 text-[11px] text-ink-faint">投稿数順・同数の場合は受け取った反応数順</p>
        </header>
        {analysis.authorRanking.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-ink-muted">ランキング対象の投稿者がいません。</p>
        ) : (
          <ol>
            {analysis.authorRanking.map((item, index) => (
              <li key={item.author.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
                <span className="w-6 shrink-0 text-center text-sm font-bold text-accent">{index + 1}</span>
                <Avatar handle={item.author.handle} displayName={item.author.displayName} avatarUrl={item.author.avatarUrl} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-ink">{item.author.displayName}</p>
                  <p className="truncate text-[11px] text-ink-faint">@{item.author.handle}</p>
                </div>
                <div className="grid shrink-0 grid-cols-2 gap-x-3 gap-y-1 text-center text-[10px] text-ink-faint sm:grid-cols-4">
                  <span><strong className="block text-sm text-ink">{item.postCount}</strong>投稿</span>
                  <span><strong className="block text-sm text-ink">{item.replyCount}</strong>返信</span>
                  <span><strong className="block text-sm text-ink">{item.repostCount}</strong>リポスト</span>
                  <span><strong className="block text-sm text-ink">{item.receivedReactionCount}</strong>反応獲得</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-surface">
        <header className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-bold text-ink">投稿ランキング</h2>
          <p className="mt-0.5 text-[11px] text-ink-faint">受け取った返信とリポストの合計順</p>
        </header>
        {analysis.ranking.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-ink-muted">ランキング対象の投稿がありません。</p>
        ) : (
          <ol>
            {analysis.ranking.map((post, index) => (
              <li key={post.postId} className="flex gap-3 border-b border-line px-4 py-3 last:border-b-0">
                <span className="w-6 shrink-0 text-center text-sm font-bold text-accent">{index + 1}</span>
                <Avatar handle={post.author.handle} displayName={post.author.displayName} avatarUrl={post.author.avatarUrl} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-ink">{post.author.displayName} <span className="font-normal text-ink-faint">@{post.author.handle}</span></p>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-muted">{post.content || "画像のみの投稿"}</p>
                </div>
                <div className="shrink-0 text-right text-[11px] text-ink-faint">
                  <p>返信 {post.replyCount}</p>
                  <p>リポスト {post.repostCount}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
