import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { SimulationSummaryDto } from "@brickr/shared";

import { ErrorBanner } from "../../components/ErrorBanner";
import { Icon } from "../../components/Icon";
import { Spinner } from "../../components/Spinner";
import { useAuth } from "../auth/AuthContext";
import { checkSignedInOnlyAccess } from "../../app/route-access";
import { formatAbsoluteTime, formatRelativeTime } from "../timeline/QuotePost";
import { roomPath } from "../../routes";
import { api, isAbortError, toErrorMessage } from "../../services/api-client";
import { RoomNameDialog } from "./RoomNameDialog";
import { writeSelectedRoomId } from "./selected-room-storage";

type Dialog = { mode: "create" } | { mode: "rename"; room: SimulationSummaryDto };

function RoomCard({
  room,
  onOpen,
  onRename,
}: {
  room: SimulationSummaryDto;
  onOpen: () => void;
  onRename?: () => void;
}) {
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
        </p>
        <p className="mt-0.5 truncate text-xs text-ink-faint">
          {room.creator ? `@${room.creator.handle}` : "作成者不明"} ・ 投稿{room.postCount.toLocaleString("ja-JP")}件
        </p>
        <p className="mt-0.5 text-xs text-ink-faint" title={formatAbsoluteTime(room.lastActivityAt)}>
          最終活動: {formatRelativeTime(room.lastActivityAt)}
        </p>
      </button>

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
    </li>
  );
}

/**
 * The room list (§5.3, §6.1, §19.1) — signed-in only, ordinary mount/unmount
 * screen (§13.5): unlike Feed/Room it costs nothing to refetch on return.
 *
 * Ordering, stopped-room visibility, and `canManage` are all decided by the
 * server (`GET /api/simulations`, §10.3) — this screen only renders what
 * comes back, newest activity first, exactly as received.
 */
export function RoomListScreen() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [rooms, setRooms] = useState<SimulationSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [dialog, setDialog] = useState<Dialog | null>(null);

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
      .getSimulations(controller.signal)
      .then(setRooms)
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
          {rooms.map((room) => (
            <RoomCard
              key={room.id}
              room={room}
              onOpen={() => openRoom(room.id)}
              {...(room.canManage ? { onRename: () => setDialog({ mode: "rename", room }) } : {})}
            />
          ))}
        </ul>
      )}

      {dialog ? (
        <RoomNameDialog
          mode={dialog.mode}
          {...(dialog.mode === "rename" ? { initialValue: dialog.room.title ?? "" } : {})}
          onClose={() => setDialog(null)}
          onSave={async (title) => {
            if (dialog.mode === "create") {
              const created = await api.createSimulation({ title });
              writeSelectedRoomId(created.id);
              setDialog(null);
              navigate(roomPath(created.id));
            } else {
              await api.updateSimulation(dialog.room.id, { title });
              setDialog(null);
              load();
            }
          }}
        />
      ) : null}
    </div>
  );
}
