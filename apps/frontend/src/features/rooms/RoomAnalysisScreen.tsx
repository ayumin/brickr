import { ErrorBanner } from "../../components/ErrorBanner";
import { Spinner } from "../../components/Spinner";
import { RoomAnalysisPanel } from "./RoomAnalysisPanel";
import { useSelectedRoom } from "./useSelectedRoom";

/**
 * Full-page wrapper for the room analysis view (`/rooms/:roomId/analysis`).
 *
 * Resolves the room via `useSelectedRoom` and delegates rendering to
 * `RoomAnalysisPanel`, which owns the snapshot fetch and update logic.
 */
export function RoomAnalysisScreen({ roomId }: { roomId: string }) {
  const selectedRoom = useSelectedRoom(roomId);

  if (selectedRoom.state.status === "denied") {
    // useSelectedRoom centralizes denial handling and redirects to the feed.
    return null;
  }

  if (selectedRoom.state.status === "loading") {
    return (
      <div className="flex items-center justify-center px-4 py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  if (selectedRoom.state.status === "error") {
    return (
      <div className="px-4 py-12">
        <ErrorBanner
          message="ルームを取得できませんでした"
          detail={selectedRoom.state.message}
          onRetry={selectedRoom.reload}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <RoomAnalysisPanel simulation={selectedRoom.state.simulation} />
    </div>
  );
}
