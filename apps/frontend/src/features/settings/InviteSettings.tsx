import { useState } from "react";
import type { CreateInviteCodeRequest } from "@brickr/shared";

import { Icon } from "../../components/Icon";
import { SecretResultDialog, type SecretResult } from "../../components/SecretResultDialog";
import { api, toErrorMessage } from "../../services/api-client";

/**
 * `/settings/invites` (§22, §66.9): issues a single-use signup invite code.
 * Split out of `UserManagementList` (which still owns the user table) so this
 * section isn't the same screen as `/settings/users` under a different URL.
 */
export function InviteSettings() {
  const [open, setOpen] = useState(false);
  const [expiresDays, setExpiresDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secretResult, setSecretResult] = useState<SecretResult | null>(null);

  async function issueInviteCode(): Promise<void> {
    setBusy(true);
    setError(null);
    const trimmed = expiresDays.trim();
    const request: CreateInviteCodeRequest = trimmed.length > 0 ? { expiresInDays: Number(trimmed) } : {};
    try {
      const inviteCode = await api.createInviteCode(request);
      setOpen(false);
      setExpiresDays("");
      setSecretResult({ title: "発行された招待コード", value: inviteCode.code });
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-sm text-ink-muted">
        自己登録は無効化されています（CLAUDE.md §66.9）。新規Userには使い捨ての招待コードを発行してください。
      </p>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="mt-4 flex items-center gap-1.5 rounded-full border border-accent/40 px-3 py-2 text-xs font-semibold text-accent transition hover:bg-accent/10"
      >
        <Icon name="key" />
        招待コードを発行
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={(event) => {
            if (event.target === event.currentTarget && !busy) setOpen(false);
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
                disabled={busy}
                value={expiresDays}
                onChange={(event) => setExpiresDays(event.currentTarget.value)}
                placeholder="無期限"
                className="mt-1.5 w-full rounded-xl border border-line bg-surface-raised px-3 py-2 text-ink focus:border-accent/60 focus:outline-none"
              />
            </label>
            {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
                className="rounded-full border border-line px-4 py-2 text-sm text-ink-muted hover:bg-surface-hover disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-full bg-accent-strong px-4 py-2 text-sm font-semibold text-white hover:bg-accent disabled:opacity-50"
              >
                {busy ? "発行中…" : "発行する"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {secretResult ? (
        <SecretResultDialog result={secretResult} onClose={() => setSecretResult(null)} />
      ) : null}
    </div>
  );
}
