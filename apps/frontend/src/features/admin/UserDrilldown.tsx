import { useEffect, useState } from "react";
import type {
  CharacterManagementDto,
  UserManagementDto,
  UserTokenUsageResponse,
} from "@brickr/shared";

import { Avatar } from "../../components/Avatar";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Icon } from "../../components/Icon";
import { Spinner } from "../../components/Spinner";
import { api, isAbortError, toErrorMessage } from "../../services/api-client";

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line bg-surface-raised p-3">
      <p className="text-xs text-ink-faint">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums text-ink">
        {value.toLocaleString("ja-JP")}
      </p>
    </div>
  );
}

/** Drilldown onto one User's created Characters and token usage (CLAUDE.md §66.7, §66.15). */
export function UserDrilldown({
  user,
  onClose,
}: {
  user: UserManagementDto;
  onClose: () => void;
}) {
  const [characters, setCharacters] = useState<CharacterManagementDto[] | null>(null);
  const [usage, setUsage] = useState<UserTokenUsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    Promise.all([
      api.getUserCharacters(user.id, controller.signal),
      api.getUserTokenUsage(user.id, controller.signal),
    ])
      .then(([loadedCharacters, loadedUsage]) => {
        setCharacters(loadedCharacters);
        setUsage(loadedUsage);
      })
      .catch((cause: unknown) => {
        if (!isAbortError(cause)) setError(toErrorMessage(cause));
      });
    return () => controller.abort();
  }, [user.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="詳細を閉じる"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-drilldown-title"
        className="relative flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-line p-5">
          <Avatar handle={user.handle} displayName={user.displayName} avatarUrl={user.avatarUrl} size="md" />
          <div className="min-w-0 flex-1">
            <h2 id="user-drilldown-title" className="truncate text-base font-bold text-ink">
              {user.displayName}
            </h2>
            <p className="truncate text-sm text-ink-faint">
              @{user.handle} · {user.email}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-surface-hover hover:text-ink"
          >
            <Icon name="x-lg" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {error ? (
            <ErrorBanner message="詳細を取得できませんでした" detail={error} />
          ) : !characters || !usage ? (
            <div className="flex justify-center py-10">
              <Spinner label="読み込み中…" />
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <h3 className="mb-2 text-sm font-bold text-ink">消費トークン</h3>
                <div className="grid grid-cols-3 gap-3">
                  <Metric label="入力" value={usage.totalInputTokens} />
                  <Metric label="出力" value={usage.totalOutputTokens} />
                  <Metric label="合計" value={usage.totalTokens} />
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-bold text-ink">
                  作成したCharacter（{characters.length}人）
                </h3>
                {characters.length === 0 ? (
                  <p className="rounded-xl border border-line bg-surface-raised p-4 text-sm text-ink-muted">
                    このUserはまだCharacterを作成していません。
                  </p>
                ) : (
                  <ul className="overflow-hidden rounded-xl border border-line">
                    {characters.map((character) => (
                      <li
                        key={character.id}
                        className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0"
                      >
                        <Avatar
                          handle={character.handle}
                          displayName={character.displayName}
                          avatarUrl={character.avatarUrl}
                          size="sm"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-ink">
                            {character.displayName}
                            <span className="ml-1.5 font-normal text-ink-faint">
                              @{character.handle}
                            </span>
                          </p>
                        </div>
                        {character.isDeleted ? (
                          <span className="shrink-0 rounded-full bg-ink-faint/15 px-2 py-0.5 text-[10px] font-semibold text-ink-muted">
                            停止
                          </span>
                        ) : null}
                        <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
                          {character.postCount.toLocaleString("ja-JP")}投稿
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
