import { useEffect, useRef, useState } from "react";
import { GLOBAL_SIMULATION_ID } from "@brickr/shared";
import type { FeedThreadDto, PostDto, UserProfileDto } from "@brickr/shared";

import { Dialog } from "../../components/Dialog";
import { Spinner } from "../../components/Spinner";
import { api, isAbortError } from "../../services/api-client";
import type { ComposerContext } from "../../types";
import { composerDialogTitle } from "./composer-utils";
import { ComposerForm } from "./ComposerForm";

export type ComposerDialogProps = {
  context: ComposerContext;
  userProfile: UserProfileDto;
  onClose: () => void;
  onPosted: (post: PostDto, thread: FeedThreadDto) => void;
  onUnauthorized: () => void;
};

type RoomState = { status: "loading" } | { status: "ready"; label: string; disabled: boolean };

/**
 * The post/reply/quote modal (§17): the one dialog every compose entry point
 * (feed, room, reply, quote) opens through (Issue #50).
 *
 * For a room-scoped new post, the caller's `roomLabel` is only a placeholder
 * for the instant before this dialog's own `getSimulation` fetch resolves the
 * authoritative title and stopped state — the same fetch a caller without a
 * known title (the nav's "投稿する" button) relies on entirely. The unified
 * feed never needs this: it is never stopped.
 */
export function ComposerDialog({ context, userProfile, onClose, onPosted, onUnauthorized }: ComposerDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const needsRoomLookup = context.mode === "new" && context.simulationId !== GLOBAL_SIMULATION_ID;
  const [roomState, setRoomState] = useState<RoomState>(() =>
    needsRoomLookup && context.mode === "new"
      ? { status: "loading" }
      : { status: "ready", label: context.mode === "new" ? context.roomLabel : "", disabled: false },
  );

  useEffect(() => {
    if (!needsRoomLookup || context.mode !== "new") {
      return;
    }
    const controller = new AbortController();
    api
      .getSimulation(context.simulationId, controller.signal)
      .then(({ simulation }) => {
        setRoomState({
          status: "ready",
          label: simulation.title ?? "無題のルーム",
          disabled: simulation.status === "archived",
        });
      })
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return;
        // Unreadable (deleted/forbidden): leave the placeholder label and let
        // submit itself fail with the usual error banner rather than a
        // separate load-error state for what is a rare race.
        setRoomState({ status: "ready", label: context.mode === "new" ? context.roomLabel : "", disabled: false });
      });
    return () => controller.abort();
    // `context` is fixed for the dialog's lifetime (a new request always
    // remounts it via `key`), so this only ever needs to run once.
  }, [needsRoomLookup]);

  // While the room lookup is in flight, `Dialog` is deliberately not mounted
  // yet at all — not just its body left empty. `Dialog`'s initial-focus
  // effect runs exactly once, on its own mount, and would otherwise have
  // nothing to focus but its close button (`ComposerForm`/`MentionInput`
  // don't exist until `roomState` is ready), contradicting the "focuses the
  // textarea on open" guarantee. A lightweight spinner gives the click
  // immediate feedback without presenting a half-built dialog; `Dialog` then
  // mounts, and focuses the now-real `textareaRef`, only once there is
  // something to show.
  if (roomState.status === "loading") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
        <Spinner size="lg" />
      </div>
    );
  }

  const title = composerDialogTitle(context);
  const headerTitle =
    context.mode === "new" && roomState.label ? `${title}・${roomState.label}` : title;

  return (
    <Dialog
      titleId="composer-dialog-title"
      title={headerTitle}
      onClose={onClose}
      closeDisabled={submitting}
      initialFocusRef={textareaRef}
      fullScreenOnMobile
    >
      <ComposerForm
        context={context}
        userProfile={userProfile}
        disabled={roomState.disabled}
        {...(roomState.disabled ? { disabledReason: "このルームは停止しています。" } : {})}
        onPosted={onPosted}
        onUnauthorized={onUnauthorized}
        onSubmittingChange={setSubmitting}
        textareaRef={textareaRef}
      />
    </Dialog>
  );
}
