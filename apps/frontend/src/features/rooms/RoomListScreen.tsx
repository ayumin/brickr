import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { RoomListEntryDto, RoomSummaryDto } from "@brickr/shared";

import { ErrorBanner } from "../../components/ErrorBanner";
import { Icon } from "../../components/Icon";
import { Spinner } from "../../components/Spinner";
import { useAuth } from "../auth/AuthContext";
import { checkSignedInOnlyAccess } from "../../app/route-access";
import { formatAbsoluteTime, formatRelativeTime } from "../timeline/QuotePost";
import { roomPath } from "../../routes";
import { api, isAbortError, toErrorMessage } from "../../services/api-client";
import { RoomNameDialog } from "./RoomNameDialog";
import { canJoinRoom } from "./room-list-actions";
import { writeSelectedRoomId } from "./selected-room-storage";

type Dialog = { mode: "create" } | { mode: "rename"; room: RoomSummaryDto };

/** Human-readable label for each visibility level. */
const VISIBILITY_LABEL: Record<string, string> = {
  public: "公開",
  open: "オープン",
  closed: "クローズド",
  private: "プライベート",
};

/**
 * Full room card — shown when the caller has access to the room's full metadata.
 */
function FullRoomCard({
  room,
  onOpen,
  onRename,
  onJoin,
  joining,
}: {
  room: RoomSummaryDto;
  onOpen: () => void;
  onRename?: () => void;
  onJoin?: () => void;
  joining?: boolean;
}) {
  const pendingCount = room.pendingCount ?? 0;

  return (
    <li className="flex items-center gap-3 border-b border-line px-4 py-3.5 transition hover:bg-surface-hover/60">
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <p className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold text-ink">{room.title ?? "無題のルーム"}</span>
          {room.status === "archived" ? (
            <span className="shrink-0 rounded-full bg-surface-raised px-2 py-0.5 text-[11px] text-ink-muted">
              停止中
            </span>
          ) : null}
          {room.visibility !== "public" ? (
            <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-muted">
              {VISIBILITY_LABEL[room.visibility] ?? room.visibility}
            </span>
          ) : null}
          {/* Pending badge — only shown to the room owner (server only sends pendingCount to owners) */}
          {pendingCount > 0 ? (
            <span
              className="shrink-0 rounded-full bg-accent-strong px-2 py-0.5 text-[11px] font-semibold text-white"
              title={`${pendingCount}件の参加申請があります`}
            >
              {pendingCount}
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 truncate text-xs text-ink-faint">
          {room.creator ? `@${room.creator.handle}` : "作成者不明"} ・ 投稿{room.postCount.toLocaleString("ja-JP")}件
        </p>
        <p className="mt-0.5 text-xs text-ink-faint" title={formatAbsoluteTime(room.lastActivityAt)}>
          最終活動: {formatRelativeTime(room.lastActivityAt)}
        </p>
      </button>

      <div className="flex shrink-0 items-center gap-1">
        {/* Join button — shown for public/open rooms where the caller is not yet a member */}
        {onJoin ? (
          <button
            type="button"
            disabled={joining}
            onClick={onJoin}
            className="rounded-full border border-accent px-3 py-1 text-xs font-semibold text-accent transition hover:bg-accent hover:text-white disabled:opacity-50"
          >
            {joining ? (
              <span className="flex items-center gap-1">
                <Spinner size="sm" />
                参加中…
              </span>
            ) : room.visibility === "public" ? (
              "参加する"
            ) : (
              "参加申請"
            )}
          </button>
        ) : null}

        {onRename ? (
          <button
            type="button"
            title="名前を変更"
            aria-label={`${room.title ?? "無題のルーム"}の名前を変更`}
            onClick={onRename}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-muted transition hover:bg-surface-hover hover:text-ink"
          >
            <Icon name="pencil" />
          </button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Restricted room card — shown for closed rooms where the caller is not a member.
 * Only id, title, visibility, and createdAt are available.
 */
function RestrictedRoomCard({
  room,
}: {
  room: { id: string; title: string | null; visibility: string; createdAt: string };
}) {
  return (
    <li className="flex items-center gap-3 border-b border-line px-4 py-3.5 opacity-60">
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold text-ink">{room.title ?? "無題のルーム"}</span>
          <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-muted">
            {VISIBILITY_LABEL[room.visibility] ?? room.visibility}
          </span>
        </p>
        <p className="mt-0.5 text-xs text-ink-faint">招待制ルーム</p>
      </div>
    </li>
  );
}

/**
 * The room list (§5.3, §6.1, §19.1) — signed-in only, ordinary mount/unmount
 * screen (§13.5): unlike Feed/Room it costs nothing to refetch on return.
 *
 * Uses `GET /api/rooms` (issue #155) for the visibility-aware list with
 * pendingCount badges for owners and join actions for public/open rooms.
 * Ordering, stopped-room visibility, and `canManage` are all decided by the
 * server — this screen only renders what comes back, newest activity first.
 */
export function RoomListScreen() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [rooms, setRooms] = useState<RoomListEntryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // Track which rooms are currently being joined (by room id)
  const [joiningIds, setJoiningIds] = useState<Set<string>>(new Set());

  const load = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    if (!authLoading && checkSignedInOnlyAccess(user).allowed === false) {
      navigate("/", { replace: true });
    }
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (authLoading || !user) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api
      .listRooms(controller.signal)
      .then(({ rooms: fetched }) => setRooms(fetched))
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return;
        setError(toErrorMessage(cause));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [authLoading, user, reloadToken]);

  const openRoom = (id: string): void => {
    writeSelectedRoomId(id);
    navigate(roomPath(id));
  };

  const joinRoom = useCallback(
    async (roomId: string): Promise<void> => {
      setJoinError(null);
      setJoiningIds((prev) => new Set(prev).add(roomId));
      try {
        await api.joinRoom(roomId);
        // Reload the list so the room's membership state is up to date
        load();
      } catch (cause: unknown) {
        setJoinError(toErrorMessage(cause));
        load();
      } finally {
        setJoiningIds((prev) => {
          const next = new Set(prev);
          next.delete(roomId);
          return next;
        });
      }
    },
    [load],
  );

  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center px-4 py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h1 className="font-display text-lg font-bold text-ink">ルーム</h1>
        <button
          type="button"
          onClick={() => setDialog({ mode: "create" })}
          className="rounded-full bg-accent-strong px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-accent"
        >
          <Icon name="plus-lg" className="mr-1.5" />
          新しいルーム
        </button>
      </header>

      {joinError ? (
        <div className="p-4 pb-0">
          <ErrorBanner
            message="ルームに参加できませんでした"
            detail={joinError}
            onDismiss={() => setJoinError(null)}
          />
        </div>
      ) : null}

      {error ? (
        <div className="p-4">
          <ErrorBanner message="ルーム一覧を取得できませんでした" detail={error} onRetry={load} />
        </div>
      ) : loading ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : rooms.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-ink-faint">
          まだルームがありません。「新しいルーム」から作成できます。
        </p>
      ) : (
        <ul>
          {rooms.map((entry) => {
            if (entry.restricted) {
              return <RestrictedRoomCard key={entry.id} room={entry} />;
            }

            // Full entry: determine whether to show a join button.
            // Membership and management are server-computed. The client only
            // combines those flags with status/visibility for presentation.
            const canJoin = canJoinRoom(entry);

            return (
              <FullRoomCard
                key={entry.id}
                room={entry}
                onOpen={() => openRoom(entry.id)}
                {...(entry.canManage
                  ? { onRename: () => setDialog({ mode: "rename", room: entry }) }
                  : {})}
                {...(canJoin
                  ? {
                      onJoin: () => void joinRoom(entry.id),
                      joining: joiningIds.has(entry.id),
                    }
                  : {})}
              />
            );
          })}
        </ul>
      )}

      {dialog ? (
        <RoomNameDialog
          mode={dialog.mode}
          {...(dialog.mode === "rename" ? { initialValue: dialog.room.title ?? "" } : {})}
          onClose={() => setDialog(null)}
          onSave={async (title) => {
            if (dialog.mode === "create") {
              const created = await api.createRoom({ title });
              writeSelectedRoomId(created.id);
              setDialog(null);
              navigate(roomPath(created.id));
            } else {
              await api.updateRoom(dialog.room.id, { title });
              setDialog(null);
              load();
            }
          }}
        />
      ) : null}
    </div>
  );
}
