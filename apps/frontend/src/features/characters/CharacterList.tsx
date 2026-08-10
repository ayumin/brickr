import { useEffect, useMemo, useState } from "react";
import type {
  CharacterBulkCreationJobDto,
  CharacterDto,
  CharacterManagementDto,
  ModelProfileDto,
} from "@enjo/shared";

import { Avatar } from "../../components/Avatar";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Icon } from "../../components/Icon";
import { Spinner } from "../../components/Spinner";
import {
  api,
  isAbortError,
  toErrorMessage,
} from "../../services/api-client";
import {
  compareOptionalNumbers,
  parseBulkCharacterCount,
  truncateText,
} from "./character-utils";

const TABLE_PROFILE_LENGTH = 50;
const TABLE_TEXT_LENGTH = 100;
const TABLE_PAGE_SIZE = 100;

export type CharacterListProps = {
  characters: CharacterDto[];
  loading: boolean;
  onCreate: () => void;
  onEdit: (character: CharacterDto) => void;
  onOpenTimeline: (character: CharacterDto) => void;
  onDeleted: (ids: string[]) => void;
  onCreated: () => void;
};

type PendingDelete = {
  ids: string[];
  label: string;
};

type BehaviorSortKey =
  | "activityLevel"
  | "responseProbability"
  | "replyProbability"
  | "quoteProbability"
  | "influence";

type SortState = {
  key: BehaviorSortKey;
  direction: "asc" | "desc";
};

const BEHAVIOR_COLUMNS: Array<{ key: BehaviorSortKey; label: string }> = [
  { key: "activityLevel", label: "活動" },
  { key: "responseProbability", label: "反応" },
  { key: "replyProbability", label: "返信" },
  { key: "quoteProbability", label: "引用" },
  { key: "influence", label: "影響" },
];

export function CharacterList({
  characters,
  loading,
  onCreate,
  onEdit,
  onOpenTimeline,
  onDeleted,
  onCreated,
}: CharacterListProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [management, setManagement] = useState<Map<string, CharacterManagementDto>>(
    () => new Map(),
  );
  const [modelProfiles, setModelProfiles] = useState<Map<string, ModelProfileDto>>(
    () => new Map(),
  );
  const [sort, setSort] = useState<SortState | null>(null);
  const [page, setPage] = useState(0);
  const [bulkCreateOpen, setBulkCreateOpen] = useState(false);
  const [bulkCountInput, setBulkCountInput] = useState("10");
  const [bulkCreating, setBulkCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [bulkJob, setBulkJob] = useState<CharacterBulkCreationJobDto | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const bulkCount = parseBulkCharacterCount(bulkCountInput);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      api.getCharacterManagement(controller.signal),
      api.getModelProfiles(controller.signal),
    ])
      .then(([loadedCharacters, loadedProfiles]) => {
        setManagement(new Map(loadedCharacters.map((character) => [character.id, character])));
        setModelProfiles(new Map(loadedProfiles.map((profile) => [profile.id, profile])));
      })
      .catch((cause: unknown) => {
        if (!isAbortError(cause)) setError(toErrorMessage(cause));
      });
    return () => controller.abort();
  }, [characters]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = !needle
      ? characters
      : characters.filter(
      (character) =>
        character.displayName.toLowerCase().includes(needle) ||
        character.handle.toLowerCase().includes(needle) ||
        character.description.toLowerCase().includes(needle),
    );
    if (!sort) return filtered;
    return [...filtered].sort((left, right) => {
      const leftValue = management.get(left.id)?.[sort.key];
      const rightValue = management.get(right.id)?.[sort.key];
      return compareOptionalNumbers(leftValue, rightValue, sort.direction);
    });
  }, [characters, management, query, sort]);

  const pageCount = Math.max(1, Math.ceil(visible.length / TABLE_PAGE_SIZE));
  const pageCharacters = visible.slice(
    page * TABLE_PAGE_SIZE,
    (page + 1) * TABLE_PAGE_SIZE,
  );

  useEffect(() => {
    setPage(0);
  }, [query, sort]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);

  const selectedIds = useMemo(
    () => characters.filter((character) => selected.has(character.id)).map(({ id }) => id),
    [characters, selected],
  );
  const allPageSelected =
    pageCharacters.length > 0 &&
    pageCharacters.every((character) => selected.has(character.id));

  function toggleSelected(id: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllOnPage(): void {
    setSelected((current) => {
      const next = new Set(current);
      for (const character of pageCharacters) {
        if (allPageSelected) next.delete(character.id);
        else next.add(character.id);
      }
      return next;
    });
  }

  function toggleSort(key: BehaviorSortKey): void {
    setSort((current) =>
      current?.key === key
        ? { key, direction: current.direction === "desc" ? "asc" : "desc" }
        : { key, direction: "desc" },
    );
  }

  async function confirmDelete(): Promise<void> {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const deletedIds =
        pendingDelete.ids.length === 1
          ? [await api.deleteCharacter(pendingDelete.ids[0]!)]
          : await api.deleteCharacters(pendingDelete.ids);
      setSelected((current) => {
        const next = new Set(current);
        for (const id of deletedIds) next.delete(id);
        return next;
      });
      setPendingDelete(null);
      onDeleted(deletedIds);
    } catch (cause) {
      setError(toErrorMessage(cause));
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  async function createBulkCharacters(): Promise<void> {
    if (bulkCreating || bulkCount === null) return;
    setBulkCreating(true);
    setBulkJob(null);
    setBulkError(null);
    setNotice(null);
    try {
      let job = await api.startCharacterBulkCreation(bulkCount);
      setBulkJob(job);
      while (job.status === "generating" || job.status === "saving") {
        await wait(500);
        job = await api.getCharacterBulkCreationJob(job.id);
        setBulkJob(job);
      }
      if (job.status === "failed") {
        throw new Error(job.error ?? "LLMによるキャラクター生成に失敗しました。");
      }
      setBulkCreateOpen(false);
      setNotice(`${String(job.createdCount)}人のキャラクターを追加しました。`);
      onCreated();
    } catch (cause) {
      setBulkError(toErrorMessage(cause));
    } finally {
      setBulkCreating(false);
    }
  }

  return (
    <section>
      <div className="space-y-3 border-b border-line px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[220px] flex-1">
            <Icon
              name="search"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-faint"
            />
            <span className="sr-only">キャラクターを検索</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="名前や@handleで絞り込む"
              className="w-full rounded-full border border-line bg-surface-raised py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent/60 focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setBulkJob(null);
              setBulkError(null);
              setBulkCreateOpen(true);
            }}
            className="rounded-full border border-accent/40 px-4 py-2 text-sm font-semibold text-accent transition hover:bg-accent/10"
          >
            <Icon name="people" className="mr-1.5" />
            一括追加
          </button>
          <button
            type="button"
            onClick={onCreate}
            className="rounded-full bg-accent-strong px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent"
          >
            <Icon name="plus-lg" className="mr-1.5" />
            新規作成
          </button>
        </div>

        <div className="flex min-h-8 flex-wrap items-center gap-3 text-sm">
          <label className="flex cursor-pointer items-center gap-2 text-ink-muted">
            <input
              type="checkbox"
              checked={allPageSelected}
              onChange={toggleAllOnPage}
              disabled={pageCharacters.length === 0}
              className="h-4 w-4 rounded border-line accent-accent-strong"
            />
            このページをすべて選択
          </label>
          <span className="text-ink-faint">
            {characters.length}人{selectedIds.length > 0 ? `・${String(selectedIds.length)}人選択中` : ""}
          </span>
          {selectedIds.length > 0 ? (
            <button
              type="button"
              onClick={() =>
                setPendingDelete({
                  ids: selectedIds,
                  label: `${String(selectedIds.length)}人のキャラクター`,
                })
              }
              className="ml-auto rounded-full border border-danger/40 px-3 py-1.5 text-xs font-semibold text-danger transition hover:bg-danger/10"
            >
              <Icon name="trash" className="mr-1.5" />
              一括削除
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="px-4 pt-3">
          <ErrorBanner
            message="キャラクター一覧を更新できませんでした"
            detail={error}
            onDismiss={() => setError(null)}
          />
        </div>
      ) : null}

      {notice ? (
        <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-sm text-ink">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="通知を閉じる"
            className="text-ink-muted hover:text-ink"
          >
            <Icon name="x-lg" />
          </button>
        </div>
      ) : null}

      {loading && characters.length === 0 ? (
        <div className="flex justify-center py-16">
          <Spinner label="キャラクターを読み込み中…" />
        </div>
      ) : visible.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <Icon name="people" className="text-3xl text-ink-faint" />
          <p className="mt-3 text-sm font-semibold text-ink">キャラクターが見つかりません</p>
          <p className="mt-1 text-xs text-ink-muted">
            {query ? "検索条件を変更してください。" : "新規作成から追加できます。"}
          </p>
        </div>
      ) : (
        <>
          <div className="max-h-[calc(100dvh-15rem)] overflow-auto">
            <table className="w-full min-w-[960px] table-fixed border-collapse text-left">
            <colgroup>
              <col className="w-12" />
              <col className="w-[300px]" />
              <col className="w-[160px]" />
              {BEHAVIOR_COLUMNS.map(({ key }) => (
                <col key={key} className="w-[68px]" />
              ))}
              <col className="w-[108px]" />
            </colgroup>
            <thead className="sticky top-0 z-10 border-b border-line bg-surface-raised text-xs text-ink-muted shadow-sm">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  <span className="sr-only">選択</span>
                </th>
                <th scope="col" className="px-3 py-3 font-medium">キャラクター</th>
                <th scope="col" className="px-3 py-3 font-medium">モデル</th>
                {BEHAVIOR_COLUMNS.map((column) => (
                  <SortableBehaviorHeader
                    key={column.key}
                    column={column}
                    sort={sort}
                    onSort={toggleSort}
                  />
                ))}
                <th scope="col" className="px-3 py-3 text-center font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {pageCharacters.map((character) => (
                <tr key={character.id} className="align-top transition hover:bg-surface-hover">
                  <td className="px-4 py-4">
                    <input
                      type="checkbox"
                      checked={selected.has(character.id)}
                      onChange={() => toggleSelected(character.id)}
                      aria-label={`${character.displayName}を選択`}
                      className="h-4 w-4 rounded border-line accent-accent-strong"
                    />
                  </td>
                  <td className="px-3 py-4">
                    <button
                      type="button"
                      onClick={() => onOpenTimeline(character)}
                      className="flex max-w-full items-start gap-3 text-left"
                      aria-label={`${character.displayName}のタイムラインを開く`}
                    >
                      <Avatar
                        handle={character.handle}
                        displayName={character.displayName}
                        avatarUrl={character.avatarUrl}
                        size="sm"
                      />
                      <span className="min-w-0">
                        <span className="flex min-w-0 items-baseline gap-1.5">
                          <span className="truncate text-sm font-semibold text-ink hover:underline">
                            {character.displayName}
                          </span>
                          <span className="truncate text-xs text-ink-faint">
                            @{character.handle}
                          </span>
                        </span>
                        <span className="mt-1 block text-xs leading-relaxed text-ink-muted">
                          {truncateText(
                            character.description,
                            TABLE_PROFILE_LENGTH,
                          )}
                        </span>
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-4 text-xs text-ink-muted">
                    <ModelSummary
                      detail={management.get(character.id)}
                      profiles={modelProfiles}
                    />
                  </td>
                  {BEHAVIOR_COLUMNS.map(({ key }) => (
                    <td
                      key={key}
                      className="px-2 py-4 text-right font-mono text-xs tabular-nums text-ink"
                    >
                      {formatPercentage(management.get(character.id)?.[key])}
                    </td>
                  ))}
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => onEdit(character)}
                        aria-label={`${character.displayName}を編集`}
                        title="編集"
                        className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition hover:bg-surface-raised hover:text-ink"
                      >
                        <Icon name="pencil" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setPendingDelete({
                            ids: [character.id],
                            label: character.displayName,
                          })
                        }
                        aria-label={`${character.displayName}を削除`}
                        title="削除"
                        className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition hover:bg-danger/10 hover:text-danger"
                      >
                        <Icon name="trash" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
          <nav
            aria-label="キャラクター一覧のページ"
            className="flex items-center justify-center gap-3 border-t border-line px-4 py-4"
          >
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              className="rounded-full border border-line px-4 py-1.5 text-xs font-semibold text-ink-muted transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              前へ
            </button>
            <span className="min-w-24 text-center text-xs text-ink-muted">
              {page + 1} / {pageCount}ページ
            </span>
            <button
              type="button"
              disabled={page >= pageCount - 1}
              onClick={() =>
                setPage((current) => Math.min(pageCount - 1, current + 1))
              }
              className="rounded-full border border-line px-4 py-1.5 text-xs font-semibold text-ink-muted transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              次へ
            </button>
            <span className="text-xs text-ink-faint">
              {page * TABLE_PAGE_SIZE + 1}–
              {Math.min((page + 1) * TABLE_PAGE_SIZE, visible.length)} / {visible.length}人
            </span>
          </nav>
        </>
      )}

      {bulkCreateOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={(event) => {
            if (event.target === event.currentTarget && !bulkCreating) {
              setBulkCreateOpen(false);
            }
          }}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-create-title"
            className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl"
            onSubmit={(event) => {
              event.preventDefault();
              void createBulkCharacters();
            }}
          >
            <h2 id="bulk-create-title" className="text-base font-bold text-ink">
              キャラクターを一括追加
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              LLMが一人ずつ異なるプロフィールとPersonaを生成し、行動傾向をランダムに設定します。
              作成後に各設定を編集できます。
            </p>
            <label className="mt-4 block text-sm text-ink-muted">
              追加する人数
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={3}
                required
                disabled={bulkCreating}
                value={bulkCountInput}
                onChange={(event) => setBulkCountInput(event.currentTarget.value)}
                className="mt-1.5 w-full rounded-xl border border-line bg-surface-raised px-3 py-2 text-ink focus:border-accent/60 focus:outline-none"
              />
              <span className="mt-1 block text-xs text-ink-faint">
                1回につき1〜100人まで追加できます。
              </span>
            </label>
            {bulkCreating || bulkJob ? (
              <div className="mt-4 rounded-xl border border-line bg-surface-raised p-3">
                <div className="flex items-center justify-between gap-3 text-xs text-ink-muted">
                  <span>{bulkProgressLabel(bulkJob, bulkCount ?? 0)}</span>
                  <span className="font-mono tabular-nums text-ink">
                    {String(bulkProgressPercent(bulkJob))}%
                  </span>
                </div>
                <progress
                  max={100}
                  value={bulkProgressPercent(bulkJob)}
                  className="mt-2 h-2 w-full accent-accent-strong"
                  aria-label="キャラクター一括作成の進捗"
                />
              </div>
            ) : null}
            {bulkError ? (
              <p className="mt-3 text-sm text-danger">{bulkError}</p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={bulkCreating}
                onClick={() => setBulkCreateOpen(false)}
                className="rounded-full border border-line px-4 py-2 text-sm text-ink-muted hover:bg-surface-hover disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={bulkCreating || bulkCount === null}
                className="rounded-full bg-accent-strong px-4 py-2 text-sm font-semibold text-white hover:bg-accent disabled:opacity-50"
              >
                {bulkCreating
                  ? "LLMで生成中…"
                  : bulkCount === null
                    ? "正しい人数を入力"
                    : `${String(bulkCount)}人を生成して追加`}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {pendingDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="削除確認を閉じる"
            onClick={() => !deleting && setPendingDelete(null)}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />
          <div role="dialog" aria-modal="true" aria-labelledby="delete-character-title" className="relative w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <h2 id="delete-character-title" className="text-base font-bold text-ink">キャラクターを削除しますか？</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              {pendingDelete.label}を一覧と今後のシミュレーションから削除します。過去の投稿は残ります。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setPendingDelete(null)} disabled={deleting} className="rounded-full border border-line px-4 py-2 text-sm text-ink-muted hover:bg-surface-hover disabled:opacity-50">
                キャンセル
              </button>
              <button type="button" onClick={() => void confirmDelete()} disabled={deleting} className="rounded-full bg-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                {deleting ? "削除中…" : "削除する"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ModelSummary({
  detail,
  profiles,
}: {
  detail: CharacterManagementDto | undefined;
  profiles: Map<string, ModelProfileDto>;
}) {
  if (!detail) return "読み込み中…";
  const profile = profiles.get(detail.modelProfileId);
  if (!profile) return truncateText(detail.modelProfileId, TABLE_TEXT_LENGTH);
  return (
    <>
      <span className="block font-semibold text-ink">
        {truncateText(profile.providerId, TABLE_TEXT_LENGTH)}
      </span>
      <span className="mt-0.5 block break-words">
        {truncateText(profile.model, TABLE_TEXT_LENGTH)}
      </span>
    </>
  );
}

function SortableBehaviorHeader({
  column,
  sort,
  onSort,
}: {
  column: { key: BehaviorSortKey; label: string };
  sort: SortState | null;
  onSort: (key: BehaviorSortKey) => void;
}) {
  const active = sort?.key === column.key;
  return (
    <th
      scope="col"
      aria-sort={
        active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
      }
      className="px-1 py-3 text-right font-medium"
    >
      <button
        type="button"
        onClick={() => onSort(column.key)}
        className={`inline-flex items-center gap-1 rounded px-1 py-0.5 transition hover:bg-surface-hover hover:text-ink ${
          active ? "text-accent" : "text-ink-muted"
        }`}
        title={`${column.label}で並び替え`}
      >
        {column.label}
        <Icon
          name={
            active
              ? sort.direction === "asc"
                ? "caret-up-fill"
                : "caret-down-fill"
              : "arrow-down-up"
          }
          className="text-[10px]"
        />
      </button>
    </th>
  );
}

function formatPercentage(value: number | undefined): string {
  return value === undefined ? "—" : `${String(Math.round(value * 100))}%`;
}

function bulkProgressPercent(job: CharacterBulkCreationJobDto | null): number {
  if (!job) return 0;
  if (job.status === "completed") return 100;
  if (job.status === "saving") return 95;
  return Math.round((job.completed / job.total) * 90);
}

function bulkProgressLabel(
  job: CharacterBulkCreationJobDto | null,
  requestedCount: number,
): string {
  if (!job) return "生成処理を開始しています…";
  if (job.status === "saving") return "生成結果を保存しています…";
  if (job.status === "completed") return "作成が完了しました。";
  if (job.status === "failed") return "生成に失敗しました。";
  return `${String(job.completed)} / ${String(requestedCount)}人を生成`;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
