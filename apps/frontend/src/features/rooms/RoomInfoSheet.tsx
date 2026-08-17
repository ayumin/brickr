import { useState } from "react";

import { Dialog } from "../../components/Dialog";
import { RoomAnalysisPanel } from "./RoomAnalysisPanel";
import { RoomInfoContent, type RoomInfoContentProps } from "./RoomInfoPanel";

export type RoomInfoSheetProps = RoomInfoContentProps & {
  onClose: () => void;
};

/**
 * Mobile bottom sheet for room info (§19.2), opened from `RoomHeader`'s info
 * button. Same content as the desktop `RoomInfoPanel`, via the shared
 * `RoomInfoContent` — only the framing differs. Uses the shared `Dialog`
 * shell's `placement="bottom-sheet"` for focus trap, Escape, backdrop tap,
 * and a real close button (§19.2: drag handle alone is not enough).
 *
 * Tracks `RoomInfoContent`'s stop/resume busy state itself, so `Dialog` can
 * disable backdrop-click/Escape while a request is in flight (CLAUDE.md
 * §50) — `RoomInfoPanel` doesn't need this since it isn't a `Dialog`.
 */
export function RoomInfoSheet({ onClose, ...content }: RoomInfoSheetProps) {
  const [busy, setBusy] = useState(false);

  return (
    <Dialog
      titleId="room-info-sheet-title"
      title="ルーム情報"
      onClose={onClose}
      closeDisabled={busy}
      placement="bottom-sheet"
    >
      <RoomInfoContent {...content} onBusyChange={setBusy} />
      <RoomAnalysisPanel room={content.room} />
    </Dialog>
  );
}
