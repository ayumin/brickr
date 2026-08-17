import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CharacterBulkCreationJobDto,
  CharacterCreatorDto,
  CharacterDto,
  CharacterManagementDto,
  CharacterDeletionMode,
  ModelProfileDto,
} from "@brickr/shared";

import { Avatar } from "../../components/Avatar";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Icon } from "../../components/Icon";
import { Spinner } from "../../components/Spinner";
import {
  api,
  isAbortError,
  toErrorMessage,
} from "../../services/api-client";
import { canManageCharacter } from "./character-ownership";
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
  currentUserId: string;
  isAdmin: boolean;
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

type NumericSortKey = BehaviorSortKey | "postCount";

type SortState = {
  key: NumericSortKey;
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
  currentUserId,
  isAdmin,
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
  const [restoringIds, setRestoringIds] = useState<Set<string>>(() => new Set());
  const [deleteMode, setDeleteMode] = useState<CharacterDeletionMode>("soft");
  const [error, setError] = useState<string | null>(null);
  const [management, setManagement] = useState<Map<string, CharacterManagementDto>>(
    () => new Map(),
  );
  const [managementLoading, setManagementLoading] = useState(true);
  const [showStopped, setShowStopped] = useState(false);
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
  const [csvBusy, setCsvBusy] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const bulkCount = parseBulkCharacterCount(bulkCountInput);

  useEffect(() => {
    const controller = new AbortController();
    setManagementLoading(true);
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
      })
      .finally(() => {
        if (!controller.signal.aborted) setManagementLoading(false);
      });
    return () => controller.abort();
  }, [characters]);

  const tableCharacters = useMemo(
    () => [...management.values()].filter((character) => showStopped || !character.isDeleted),
    [management, showStopped],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = !needle
      ? tableCharacters
      : tableCharacters.filter(
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
  }, [management, query, sort, tableCharacters]);

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
    () => tableCharacters.filter((character) => selected.has(character.id)).map(({ id }) => id),
    [selected, tableCharacters],
  );
  const manageablePageCharacters = useMemo(
    () => pageCharacters.filter((character) => canManageCharacter(character, currentUserId, isAdmin)),
    [pageCharacters, currentUserId, isAdmin],
  );
  const allPageSelected =
    manageablePageCharacters.length > 0 &&
    manageablePageCharacters.every((character) => selected.has(character.id));

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
      for (const character of manageablePageCharacters) {
        if (allPageSelected) next.delete(character.id);
        else next.add(character.id);
      }
      return next;
    });
  }

  function toggleSort(key: NumericSortKey): void {
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
          ? [await api.deleteCharacter(pendingDelete.ids[0]!, deleteMode)]
          : await api.deleteCharacters(pendingDelete.ids, deleteMode);
      setSelected((current) => {
        const next = new Set(current);
        for (const id of deletedIds) next.delete(id);
        return next;
      });
      setManagement((current) => {
        const next = new Map(current);
        for (const id of deletedIds) {
          const character = next.get(id);
          if (deleteMode === "hard") next.delete(id);
          else if (character) next.set(id, { ...character, isDeleted: true });
        }
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

  async function restoreCharacter(character: CharacterManagementDto): Promise<void> {
    if (restoringIds.has(character.id)) return;
    setRestoringIds((current) => new Set(current).add(character.id));
    setError(null);
    try {
      await api.restoreCharacter(character.id);
      setManagement((current) => {
        const next = new Map(current);
        const restored = next.get(character.id);
        if (restored) next.set(character.id, { ...restored, isDeleted: false });
        return next;
      });
      setNotice(`${character.displayName}を復活しました。`);
      onCreated();
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setRestoringIds((current) => {
        const next = new Set(current);
        next.delete(character.id);
        return next;
      });
    }
  }

  async function exportCsv(): Promise<void> {
    setCsvBusy(true);
    setError(null);
    try {
      const exported = await api.exportCharactersCsv();
      const url = URL.createObjectURL(new Blob([exported.csv], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = exported.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setCsvBusy(false);
    }
  }

  async function importCsv(file: File): Promise<void> {
    setCsvBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.importCharactersCsv(await file.text());
      setNotice(
        `${String(result.importedCount)}人をインポートしました（新規${String(result.createdCount)}人・更新${String(result.updatedCount)}人）。`,
      );
      onCreated();
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setCsvBusy(false);
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
        throw new Error(job.error ?? "LLMによるキャスト生成に失敗しました。");
      }
      setBulkCreateOpen(false);
      setNotice(`${String(job.createdCount)}人のキャストを追加しました。`);
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
            <span className="sr-only">キャストを検索</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="名前や@handleで絞り込む"
              className="w-full rounded-full border border-line bg-surface-raised py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent/60 focus:outline-none"
            />
          </label>
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void importCsv(file);
            }}
          />
          <button
            type="button"
            disabled={csvBusy}
            onClick={() => void exportCsv()}
            aria-label="CSVをエクスポート"
            title="CSVをエクスポート"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-sm text-ink-muted transition hover:bg-surface-hover hover:text-ink disabled:opacity-50"
          >
            <Icon name="download" />
          </button>
          <button
            type="button"
            disabled={csvBusy}
            onClick={() => csvInputRef.current?.click()}
            aria-label="CSVをインポート"
            title="CSVをインポート"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-sm text-ink-muted transition hover:bg-surface-hover hover:text-ink disabled:opacity-50"
          >
            <Icon name="upload" />
          </button>
          <button
            type="button"
            onClick={() => {
              setBulkJob(null);
              setBulkError(null);
              setBulkCreateOpen(true);
            }}
            aria-label="キャストを一括追加"
            title="キャストを一括追加"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-accent/40 text-sm text-accent transition hover:bg-accent/10"
          >
            <Icon name="magic" />
          </button>
          <button
            type="button"
            onClick={onCreate}
            aria-label="キャストを新規追加"
            title="キャストを新規追加"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-strong text-sm text-white transition hover:bg-accent"
          >
            <Icon name="plus-circle" />
          </button>
        </div>

        <div className="flex min-h-8 flex-wrap items-center gap-4 text-sm">
          <label className="flex cursor-pointer items-center gap-2 text-ink-muted">
            <input
              type="checkbox"
              role="switch"
              checked={showStopped}
              onChange={(event) => setShowStopped(event.currentTarget.checked)}
              className="peer sr-only"
            />
            <span className="relative h-5 w-9 rounded-full bg-line-strong transition after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition after:content-[''] peer-checked:bg-accent peer-checked:after:translate-x-4" />
            停止キャストを表示
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-ink-muted">
            <input
              type="checkbox"
              checked={allPageSelected}
              onChange={toggleAllOnPage}
              disabled={manageablePageCharacters.length === 0}
              className="h-4 w-4 rounded border-line accent-accent-strong"
            />
            このページをすべて選択
          </label>
          <span className="text-ink-faint">
            {tableCharacters.length}人{selectedIds.length > 0 ? `・${String(selectedIds.length)}人選択中` : ""}
          </span>
          {selectedIds.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setDeleteMode("soft");
                setPendingDelete({
                  ids: selectedIds,
                  label: `${String(selectedIds.length)}人のキャスト`,
                });
              }}
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
            message="キャスト一覧を更新できませんでした"
            detail={error}
            onDismiss={() => setError(null)}
          />
        </div>
      ) : null}

      {notice ? (
        <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-xl border border-live/40 bg-live/10 px-3 py-2 text-sm text-ink">
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

      {(loading || managementLoading) && management.size === 0 ? (
        <div className="flex justify-center py-16">
          <Spinner label="キャストを読み込み中…" />
        </div>
      ) : visible.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <Icon name="people" className="text-3xl text-ink-faint" />
          <p className="mt-3 text-sm font-semibold text-ink">キャストが見つかりません</p>
          <p className="mt-1 text-xs text-ink-muted">
            {query ? "検索条件を変更してください。" : "新規作成から追加できます。"}
          </p>
        </div>
      ) : (
        <>
          <div className="max-h-[calc(100dvh-15rem)] overflow-auto">
            <table className={`w-full ${isAdmin ? "min-w-[900px]" : "min-w-[800px]"} table-fixed border-collapse text-left text-[11px]`}>
            <colgroup>
              <col className="w-10" />
              <col className="w-[260px]" />
              <col className="w-[120px]" />
              {isAdmin ? <col className="w-[140px]" /> : null}
              <col className="w-14" />
              {BEHAVIOR_COLUMNS.map(({ key }) => (
                <col key={key} className="w-[50px]" />
              ))}
              <col className="w-[84px]" />
            </colgroup>
            <thead className="sticky top-0 z-10 border-b border-line bg-surface-raised text-[11px] text-ink-muted shadow-sm">
              <tr>
                <th scope="col" className="px-3 py-3 font-medium">
                  <span className="sr-only">選択</span>
                </th>
                <th scope="col" className="px-3 py-3 font-medium">キャスト</th>
                <th scope="col" className="px-3 py-3 font-medium">モデル</th>
                {isAdmin ? (
                  <th scope="col" className="px-3 py-3 font-medium">作成者</th>
                ) : null}
                <SortableBehaviorHeader
                  column={{ key: "postCount", label: "投稿数" }}
                  sort={sort}
                  onSort={toggleSort}
                />
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
              {pageCharacters.map((character) => {
                const canManage = canManageCharacter(character, currentUserId, isAdmin);
                return (
                <tr key={character.id} className="align-top transition hover:bg-surface-hover">
                  <td className="px-3 py-4">
                    <input
                      type="checkbox"
                      checked={selected.has(character.id)}
                      onChange={() => toggleSelected(character.id)}
                      disabled={!canManage}
                      aria-label={`${character.displayName}を選択`}
                      title={canManage ? undefined : "他のユーザーが作成したキャストです"}
                      className="h-4 w-4 rounded border-line accent-accent-strong disabled:opacity-40"
                    />
                  </td>
                  <td className="px-3 py-4">
                    <button
                      type="button"
                      onClick={() => onOpenTimeline(character)}
                      className="flex max-w-full items-start gap-3 text-left"
                      aria-label={`${character.displayName}のタイムラインを開く`}
                    >
                      <span className="flex shrink-0 flex-col items-center gap-1">
                        <Avatar
                          handle={character.handle}
                          displayName={character.displayName}
                          avatarUrl={character.avatarUrl}
                          size="sm"
                        />
                        {character.isDeleted ? (
                          <span className="rounded-full bg-ink-faint/15 px-1.5 py-0.5 text-[8px] font-semibold leading-none text-ink-muted">
                            停止
                          </span>
                        ) : null}
                      </span>
                      <span className="min-w-0">
                        <span className="flex min-w-0 items-baseline gap-1.5">
                          <span className="truncate text-xs font-semibold text-ink hover:underline">
                            {character.displayName}
                          </span>
                          <span className="truncate text-[11px] text-ink-faint">
                            @{character.handle}
                          </span>
                        </span>
                        <span className="mt-1 block text-[9px] leading-relaxed text-ink-muted">
                          {truncateText(
                            character.description,
                            TABLE_PROFILE_LENGTH,
                          )}
                        </span>
                      </span>
                    </button>
                  </td>
                  <td className="px-2 py-4 text-[9px] leading-tight text-ink-muted">
                    <ModelSummary
                      detail={management.get(character.id)}
                      profiles={modelProfiles}
                    />
                  </td>
                  {isAdmin ? (
                    <td className="px-2 py-4 text-[9px] leading-tight text-ink-muted">
                      <CreatorSummary creator={management.get(character.id)?.creator} />
                    </td>
                  ) : null}
                  <td className="px-1 py-4 text-right font-mono text-[10px] tabular-nums text-ink">
                    {management.get(character.id)?.postCount.toLocaleString("ja-JP") ?? "—"}
                  </td>
                  {BEHAVIOR_COLUMNS.map(({ key }) => (
                    <td
                      key={key}
                      className="px-1 py-4 text-right font-mono text-[10px] tabular-nums text-ink"
                    >
                      {formatPercentage(management.get(character.id)?.[key])}
                    </td>
                  ))}
                  <td className="px-1 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        disabled={!canManage}
                        onClick={() => onEdit(character)}
                        aria-label={`${character.displayName}の設定を編集`}
                        title={canManage ? "設定を編集" : "他のユーザーが作成したキャストです"}
                        className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition hover:bg-surface-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                      >
                        <Icon name="gear" />
                      </button>
                      {character.isDeleted ? (
                        <button
                          type="button"
                          disabled={!canManage || restoringIds.has(character.id)}
                          onClick={() => void restoreCharacter(character)}
                          aria-label={`${character.displayName}を復活`}
                          title={canManage ? "復活" : "他のユーザーが作成したキャストです"}
                          className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                        >
                          <Icon name="recycle" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={!canManage}
                          onClick={() => {
                            setDeleteMode("soft");
                            setPendingDelete({
                              ids: [character.id],
                              label: character.displayName,
                            });
                          }}
                          aria-label={`${character.displayName}を削除`}
                          title={canManage ? "削除" : "他のユーザーが作成したキャストです"}
                          className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                        >
                          <Icon name="trash" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
            </table>
          </div>
          <nav
            aria-label="キャスト一覧のページ"
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
              キャストを一括追加
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
                  aria-label="キャスト一括作成の進捗"
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
            <h2 id="delete-character-title" className="text-base font-bold text-ink">キャストを削除しますか？</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              {pendingDelete.label}を削除します。削除方法を選択してください。
            </p>
            <fieldset className="mt-4 space-y-2">
              <label className={`block cursor-pointer rounded-xl border p-3 ${deleteMode === "soft" ? "border-accent bg-accent/10" : "border-line"}`}>
                <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <input type="radio" name="deleteMode" value="soft" checked={deleteMode === "soft"} onChange={() => setDeleteMode("soft")} className="accent-accent-strong" />
                  論理削除
                </span>
                <span className="mt-1 block pl-6 text-xs text-ink-muted">一覧から除外します。既存の投稿は残ります。</span>
              </label>
              <label className={`block cursor-pointer rounded-xl border p-3 ${deleteMode === "hard" ? "border-danger bg-danger/10" : "border-line"}`}>
                <span className="flex items-center gap-2 text-sm font-semibold text-danger">
                  <input type="radio" name="deleteMode" value="hard" checked={deleteMode === "hard"} onChange={() => setDeleteMode("hard")} className="accent-danger" />
                  完全に削除
                </span>
                <span className="mt-1 block pl-6 text-xs text-ink-muted">キャストとその投稿を完全に削除します。この操作は元に戻せません。</span>
              </label>
            </fieldset>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setPendingDelete(null)} disabled={deleting} className="rounded-full border border-line px-4 py-2 text-sm text-ink-muted hover:bg-surface-hover disabled:opacity-50">
                キャンセル
              </button>
              <button type="button" onClick={() => void confirmDelete()} disabled={deleting} className="rounded-full bg-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                {deleting ? "削除中…" : deleteMode === "hard" ? "完全に削除する" : "論理削除する"}
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
      <span className="block text-[9px] font-semibold leading-tight text-ink">
        {truncateText(profile.providerId, TABLE_TEXT_LENGTH)}
      </span>
      <span className="mt-0.5 block break-words text-[9px] leading-tight">
        {truncateText(profile.model, TABLE_TEXT_LENGTH)}
      </span>
    </>
  );
}

/**
 * §20.3: shown to an admin only (the `creator` field itself is absent for
 * anyone else). `null` means System-owned; never render the raw user id.
 */
function CreatorSummary({ creator }: { creator: CharacterCreatorDto | null | undefined }) {
  if (creator === undefined) return "—";
  if (creator === null) return "System";
  return (
    <>
      <span className="block truncate text-[9px] font-semibold leading-tight text-ink">
        {truncateText(creator.displayName, TABLE_TEXT_LENGTH)}
      </span>
      <span className="mt-0.5 block truncate text-[9px] leading-tight">
        @{creator.handle}
      </span>
    </>
  );
}

function SortableBehaviorHeader({
  column,
  sort,
  onSort,
}: {
  column: { key: NumericSortKey; label: string };
  sort: SortState | null;
  onSort: (key: NumericSortKey) => void;
}) {
  const active = sort?.key === column.key;
  return (
    <th
      scope="col"
      aria-sort={
        active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
      }
      className="px-0.5 py-3 text-right font-medium"
    >
      <button
        type="button"
        onClick={() => onSort(column.key)}
        className={`inline-flex items-center gap-0.5 rounded px-0.5 py-0.5 transition hover:bg-surface-hover hover:text-ink ${
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
