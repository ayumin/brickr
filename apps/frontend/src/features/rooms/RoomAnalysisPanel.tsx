import type { RoomAnalysisSnapshotDto, SimulationSummaryDto } from "@brickr/shared";

import { ErrorBanner } from "../../components/ErrorBanner";
import { Icon } from "../../components/Icon";
import { Spinner } from "../../components/Spinner";
import { useRoomAnalysisSnapshot } from "./useRoomAnalysisSnapshot";

// ---------------------------------------------------------------------------
// Summary parsing
// ---------------------------------------------------------------------------

type ParsedSummary = {
  overallTopics: string;
  postOverview: string;
  highEngagementTopics: string;
  lowEngagementTopics: string;
};

function parseSummary(raw: string | null): ParsedSummary | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "overallTopics" in parsed &&
      "postOverview" in parsed &&
      "highEngagementTopics" in parsed &&
      "lowEngagementTopics" in parsed
    ) {
      return parsed as ParsedSummary;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SnapshotSummaryDisplay({ summary }: { summary: ParsedSummary }) {
  return (
    <dl className="space-y-3">
      {[
        ["全体の話題", summary.overallTopics],
        ["投稿の概要", summary.postOverview],
        ["反響が大きかった話題", summary.highEngagementTopics],
        ["反響が少なかった話題", summary.lowEngagementTopics],
      ].map(([label, value]) => (
        <div key={label}>
          <dt className="text-[11px] font-semibold text-ink">{label}</dt>
          <dd className="mt-0.5 whitespace-pre-wrap text-xs leading-5 text-ink-muted">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SnapshotDisplay({ snapshot }: { snapshot: RoomAnalysisSnapshotDto }) {
  if (snapshot.status === "pending") {
    return (
      <div className="flex items-center gap-2 text-xs text-ink-muted">
        <Spinner size="sm" />
        分析中…
      </div>
    );
  }

  if (snapshot.status === "failed") {
    const lastSummary = snapshot.lastSuccessful
      ? parseSummary(snapshot.lastSuccessful.summary)
      : null;

    return (
      <div className="space-y-3">
        <p className="text-xs text-error">
          分析に失敗しました。
        </p>
        {lastSummary ? (
          <div>
            <p className="mb-2 text-[11px] text-ink-faint">（直近の成功結果を表示中）</p>
            <SnapshotSummaryDisplay summary={lastSummary} />
          </div>
        ) : (
          <p className="text-xs text-ink-faint">表示できる分析結果がありません。</p>
        )}
      </div>
    );
  }

  // status === "completed"
  const summary = parseSummary(snapshot.summary);
  if (!summary) {
    return <p className="text-xs text-ink-faint">分析結果を表示できません。</p>;
  }

  return <SnapshotSummaryDisplay summary={summary} />;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export type RoomAnalysisPanelProps = {
  simulation: SimulationSummaryDto;
};

/**
 * Room analysis snapshot panel (issue #170).
 *
 * Displayed in the right panel of the Room screen, below the room info.
 * - Active members see the snapshot (read-only).
 * - Owners see an "更新する" button, enabled only when `hasChanges` is
 *   implied by the snapshot being absent or the room having new posts.
 * - Shows running/failed/last-successful states appropriately.
 */
export function RoomAnalysisPanel({ simulation }: RoomAnalysisPanelProps) {
  const { state, updating, updateError, dismissUpdateError, update } =
    useRoomAnalysisSnapshot(simulation.id);

  const isOwner = simulation.canManage;
  const isArchived = simulation.status === "archived";

  // Owners can update when: not archived, not currently updating, and either
  // there's no snapshot yet or the snapshot is not "pending".
  const canUpdate =
    isOwner &&
    !isArchived &&
    !updating &&
    state.status !== "loading" &&
    !(state.status === "ready" && state.snapshot.status === "pending");

  return (
    <section className="border-t border-line p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold text-ink">ルーム分析</h3>
        {isOwner && !isArchived ? (
          <button
            type="button"
            disabled={!canUpdate}
            onClick={() => void update()}
            className="flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-muted transition hover:bg-surface-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {updating ? (
              <>
                <Spinner size="sm" />
                更新中…
              </>
            ) : (
              <>
                <Icon name="recycle" />
                更新する
              </>
            )}
          </button>
        ) : null}
      </div>

      {updateError ? (
        <div className="mb-3">
          <ErrorBanner
            message="分析の更新に失敗しました"
            detail={updateError}
            onDismiss={dismissUpdateError}
          />
        </div>
      ) : null}

      {state.status === "loading" ? (
        <div className="flex justify-center py-4">
          <Spinner size="sm" />
        </div>
      ) : state.status === "forbidden" ? (
        <p className="text-xs text-ink-faint">分析結果を閲覧する権限がありません。</p>
      ) : state.status === "none" ? (
        <p className="text-xs text-ink-faint">
          {isOwner
            ? "まだ分析が生成されていません。「更新する」を押して分析を開始してください。"
            : "まだ分析が生成されていません。"}
        </p>
      ) : state.status === "error" ? (
        <p className="text-xs text-error">{state.message}</p>
      ) : (
        <SnapshotDisplay snapshot={state.snapshot} />
      )}
    </section>
  );
}
