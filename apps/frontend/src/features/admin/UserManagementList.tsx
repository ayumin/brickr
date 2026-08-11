import { useEffect, useState } from "react";
import type { CreateInviteCodeRequest, UserManagementDto } from "@brickr/shared";
import { USER_MANAGEMENT_PAGE_SIZE } from "@brickr/shared";

import { Avatar } from "../../components/Avatar";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Icon } from "../../components/Icon";
import { Spinner } from "../../components/Spinner";
import { api, isAbortError, toErrorMessage } from "../../services/api-client";
import { UserDrilldown } from "./UserDrilldown";

const SEARCH_DEBOUNCE_MS = 300;

type PendingAction =
  | { kind: "suspend"; user: UserManagementDto }
  | { kind: "reset-password"; user: UserManagementDto };

type SecretResult = { title: string; value: string };

function statusLabel(status: UserManagementDto["status"]): string {
  return status === "suspended" ? "停止中" : "有効";
}

export function UserManagementList() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState<UserManagementDto[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [secretResult, setSecretResult] = useState<SecretResult | null>(null);
  const [drilldownUser, setDrilldownUser] = useState<UserManagementDto | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteExpiresDays, setInviteExpiresDays] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Debounced: the backend requires a real round trip per keystroke otherwise.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api
      .getUserManagement({ page, ...(search ? { search } : {}) }, controller.signal)
      .then((response) => {
        setUsers(response.users);
        setTotalCount(response.totalCount);
      })
      .catch((cause: unknown) => {
        if (!isAbortError(cause)) setError(toErrorMessage(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, search, reloadToken]);

  const pageCount = Math.max(1, Math.ceil(totalCount / USER_MANAGEMENT_PAGE_SIZE));

  function setBusy(id: string, busy: boolean): void {
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function applyUpdate(updated: UserManagementDto): void {
    setUsers((current) => current.map((user) => (user.id === updated.id ? updated : user)));
  }

  async function reactivate(user: UserManagementDto): Promise<void> {
    setBusy(user.id, true);
    setActionError(null);
    try {
      applyUpdate(await api.reactivateUser(user.id));
    } catch (cause) {
      setActionError(toErrorMessage(cause));
    } finally {
      setBusy(user.id, false);
    }
  }

  async function confirmPendingAction(): Promise<void> {
    if (!pendingAction) return;
    const { user } = pendingAction;
    setBusy(user.id, true);
    setActionError(null);
    try {
      if (pendingAction.kind === "suspend") {
        applyUpdate(await api.suspendUser(user.id));
        setPendingAction(null);
      } else {
        const temporaryPassword = await api.resetUserPassword(user.id);
        setPendingAction(null);
        setSecretResult({ title: "発行された仮パスワード", value: temporaryPassword });
      }
    } catch (cause) {
      setActionError(toErrorMessage(cause));
      setPendingAction(null);
    } finally {
      setBusy(user.id, false);
    }
  }

  async function issueInviteCode(): Promise<void> {
    setInviteBusy(true);
    setInviteError(null);
    const trimmed = inviteExpiresDays.trim();
    const request: CreateInviteCodeRequest =
      trimmed.length > 0 ? { expiresInDays: Number(trimmed) } : {};
    try {
      const inviteCode = await api.createInviteCode(request);
      setInviteOpen(false);
      setInviteExpiresDays("");
      setSecretResult({ title: "発行された招待コード", value: inviteCode.code });
    } catch (cause) {
      setInviteError(toErrorMessage(cause));
    } finally {
      setInviteBusy(false);
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
            <span className="sr-only">Userを検索</span>
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.currentTarget.value)}
              placeholder="表示名・@handle・emailで絞り込む"
              className="w-full rounded-full border border-line bg-surface-raised py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent/60 focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setInviteError(null);
              setInviteOpen(true);
            }}
            className="flex items-center gap-1.5 rounded-full border border-accent/40 px-3 py-2 text-xs font-semibold text-accent transition hover:bg-accent/10"
          >
            <Icon name="key" />
            招待コードを発行
          </button>
        </div>
        <p className="text-xs text-ink-faint">{totalCount.toLocaleString("ja-JP")}人</p>
      </div>

      {error ? (
        <div className="px-4 pt-3">
          <ErrorBanner
            message="User一覧を取得できませんでした"
            detail={error}
            onRetry={() => setReloadToken((value) => value + 1)}
          />
        </div>
      ) : null}

      {actionError ? (
        <div className="px-4 pt-3">
          <ErrorBanner
            message="操作に失敗しました"
            detail={actionError}
            onDismiss={() => setActionError(null)}
          />
        </div>
      ) : null}

      {loading && users.length === 0 ? (
        <div className="flex justify-center py-16">
          <Spinner label="Userを読み込み中…" />
        </div>
      ) : users.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <Icon name="people" className="text-3xl text-ink-faint" />
          <p className="mt-3 text-sm font-semibold text-ink">Userが見つかりません</p>
          <p className="mt-1 text-xs text-ink-muted">検索条件を変更してください。</p>
        </div>
      ) : (
        <>
          <div className="max-h-[calc(100dvh-15rem)] overflow-auto">
            <table className="w-full min-w-[720px] table-fixed border-collapse text-left text-[11px]">
              <colgroup>
                <col className="w-[260px]" />
                <col className="w-[200px]" />
                <col className="w-20" />
                <col className="w-16" />
                <col className="w-[160px]" />
              </colgroup>
              <thead className="sticky top-0 z-10 border-b border-line bg-surface-raised text-[11px] text-ink-muted shadow-sm">
                <tr>
                  <th scope="col" className="px-3 py-3 font-medium">User</th>
                  <th scope="col" className="px-3 py-3 font-medium">email</th>
                  <th scope="col" className="px-3 py-3 font-medium">状態</th>
                  <th scope="col" className="px-3 py-3 font-medium">権限</th>
                  <th scope="col" className="px-3 py-3 text-center font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {users.map((user) => {
                  const busy = busyIds.has(user.id);
                  return (
                    <tr key={user.id} className="align-top transition hover:bg-surface-hover">
                      <td className="px-3 py-4">
                        <button
                          type="button"
                          onClick={() => setDrilldownUser(user)}
                          className="flex max-w-full items-center gap-3 text-left"
                          aria-label={`${user.displayName}の詳細を開く`}
                        >
                          <Avatar
                            handle={user.handle}
                            displayName={user.displayName}
                            avatarUrl={user.avatarUrl}
                            size="sm"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-semibold text-ink hover:underline">
                              {user.displayName}
                            </span>
                            <span className="block truncate text-[11px] text-ink-faint">
                              @{user.handle}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="px-3 py-4 text-[11px] text-ink-muted">
                        <span className="block truncate">{user.email}</span>
                      </td>
                      <td className="px-3 py-4">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            user.status === "suspended"
                              ? "bg-danger/10 text-danger"
                              : "bg-emerald-400/10 text-emerald-600"
                          }`}
                        >
                          {statusLabel(user.status)}
                        </span>
                      </td>
                      <td className="px-3 py-4 text-[11px] text-ink-muted">
                        {user.isAdmin ? "Admin" : "—"}
                      </td>
                      <td className="px-1 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => setDrilldownUser(user)}
                            aria-label={`${user.displayName}の詳細を開く`}
                            title="詳細（作成Character・消費トークン）"
                            className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition hover:bg-surface-raised hover:text-ink"
                          >
                            <Icon name="arrows-angle-expand" />
                          </button>
                          {user.status === "suspended" ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void reactivate(user)}
                              aria-label={`${user.displayName}を復帰`}
                              title="復帰"
                              className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition hover:bg-accent/10 hover:text-accent disabled:opacity-50"
                            >
                              <Icon name="person-check" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setActionError(null);
                                setPendingAction({ kind: "suspend", user });
                              }}
                              aria-label={`${user.displayName}を停止`}
                              title="停止"
                              className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition hover:bg-danger/10 hover:text-danger disabled:opacity-50"
                            >
                              <Icon name="person-x" />
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setActionError(null);
                              setPendingAction({ kind: "reset-password", user });
                            }}
                            aria-label={`${user.displayName}に仮パスワードを発行`}
                            title="仮パスワードを発行"
                            className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition hover:bg-surface-raised hover:text-ink disabled:opacity-50"
                          >
                            <Icon name="key" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <nav
            aria-label="User一覧のページ"
            className="flex items-center justify-center gap-3 border-t border-line px-4 py-4"
          >
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="rounded-full border border-line px-4 py-1.5 text-xs font-semibold text-ink-muted transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              前へ
            </button>
            <span className="min-w-24 text-center text-xs text-ink-muted">
              {page} / {pageCount}ページ
            </span>
            <button
              type="button"
              disabled={page >= pageCount}
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              className="rounded-full border border-line px-4 py-1.5 text-xs font-semibold text-ink-muted transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              次へ
            </button>
          </nav>
        </>
      )}

      {pendingAction ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="確認を閉じる"
            onClick={() => setPendingAction(null)}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pending-action-title"
            className="relative w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl"
          >
            <h2 id="pending-action-title" className="text-base font-bold text-ink">
              {pendingAction.kind === "suspend"
                ? "このUserを停止しますか？"
                : "仮パスワードを発行しますか？"}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              {pendingAction.kind === "suspend"
                ? `${pendingAction.user.displayName}（@${pendingAction.user.handle}）はログインできなくなり、既存のセッションもすべて失効します。`
                : `${pendingAction.user.displayName}（@${pendingAction.user.handle}）の既存セッションはすべて失効し、新しい仮パスワードでのログインが必要になります。`}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                disabled={busyIds.has(pendingAction.user.id)}
                className="rounded-full border border-line px-4 py-2 text-sm text-ink-muted hover:bg-surface-hover disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => void confirmPendingAction()}
                disabled={busyIds.has(pendingAction.user.id)}
                className="rounded-full bg-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {busyIds.has(pendingAction.user.id)
                  ? "処理中…"
                  : pendingAction.kind === "suspend"
                    ? "停止する"
                    : "発行する"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {inviteOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={(event) => {
            if (event.target === event.currentTarget && !inviteBusy) setInviteOpen(false);
          }}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-code-title"
            className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl"
            onSubmit={(event) => {
              event.preventDefault();
              void issueInviteCode();
            }}
          >
            <h2 id="invite-code-title" className="text-base font-bold text-ink">
              招待コードを発行
            </h2>
            <label className="mt-4 block text-sm text-ink-muted">
              有効期限（日数、任意）
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                disabled={inviteBusy}
                value={inviteExpiresDays}
                onChange={(event) => setInviteExpiresDays(event.currentTarget.value)}
                placeholder="無期限"
                className="mt-1.5 w-full rounded-xl border border-line bg-surface-raised px-3 py-2 text-ink focus:border-accent/60 focus:outline-none"
              />
            </label>
            {inviteError ? <p className="mt-3 text-sm text-danger">{inviteError}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={inviteBusy}
                onClick={() => setInviteOpen(false)}
                className="rounded-full border border-line px-4 py-2 text-sm text-ink-muted hover:bg-surface-hover disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={inviteBusy}
                className="rounded-full bg-accent-strong px-4 py-2 text-sm font-semibold text-white hover:bg-accent disabled:opacity-50"
              >
                {inviteBusy ? "発行中…" : "発行する"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {secretResult ? (
        <SecretResultDialog result={secretResult} onClose={() => setSecretResult(null)} />
      ) : null}

      {drilldownUser ? (
        <UserDrilldown user={drilldownUser} onClose={() => setDrilldownUser(null)} />
      ) : null}
    </section>
  );
}

/**
 * Shown exactly once (CLAUDE.md §66.10): the invite code or temporary
 * password is never retrievable again after this, so closing requires an
 * explicit click rather than a background click that could happen by accident.
 */
function SecretResultDialog({
  result,
  onClose,
}: {
  result: SecretResult;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="secret-result-title"
        className="relative w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl"
      >
        <h2 id="secret-result-title" className="text-base font-bold text-ink">
          {result.title}
        </h2>
        <p className="mt-2 text-xs text-ink-muted">
          この値は今だけ表示されます。担当のUserへ別の手段で伝えてください。
        </p>
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-line bg-surface-raised px-3 py-2">
          <code className="min-w-0 flex-1 break-all text-sm text-ink">{result.value}</code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(result.value).then(() => {
                setCopied(true);
              });
            }}
            aria-label="コピー"
            title="コピー"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-muted transition hover:bg-surface-hover hover:text-ink"
          >
            <Icon name="clipboard" />
          </button>
        </div>
        {copied ? <p className="mt-1.5 text-xs text-accent">コピーしました。</p> : null}
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-accent-strong px-4 py-2 text-sm font-semibold text-white hover:bg-accent"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
