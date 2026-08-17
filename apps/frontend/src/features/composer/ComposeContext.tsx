import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { FeedThreadDto, PostDto } from "@brickr/shared";

import { useAuth } from "../auth/AuthContext";
import { AuthDialog } from "../auth/AuthDialog";
import { useAuthIntent } from "../auth/AuthIntentContext";
import { useUserProfile } from "../../hooks/useUserProfile";
import type { ComposerContext } from "../../types";
import { ComposerDialog } from "./ComposerDialog";

export type ComposeRequest = {
  context: ComposerContext;
  /** Runs in addition to closing the dialog — each trigger site's own follow-up (e.g. `feed.upsertThread`). */
  onPosted?: (post: PostDto, thread: FeedThreadDto) => void;
};

type ComposeControllerValue = {
  /**
   * Open the composer for `request.context`, unless signed out — in which
   * case the request is remembered and the auth dialog opens instead (§18.2).
   * Every compose entry point (nav button, feed/room reply/quote, post
   * detail) calls this one function; none of them need to know about auth.
   */
  request: (request: ComposeRequest) => void;
};

const ComposeContext = createContext<ComposeControllerValue | null>(null);

/**
 * Owns composer open/close/scope and the auth-intent detour (§13.2: "投稿先
 * Composer：AppShell直下のcontrollerがopen/close/scope/auth intentを所有").
 * Mounted once by `AppShell`, so it is unaffected by Cast/Rooms-list/Settings
 * mounting and unmounting underneath it (§13.5).
 */
export function ComposeControllerProvider({ children }: { children: ReactNode }) {
  const { user, setUser } = useAuth();
  const authIntent = useAuthIntent();
  const userProfile = useUserProfile();

  const [composerRequest, setComposerRequest] = useState<ComposeRequest | null>(null);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  // Remembers the full request (including `onPosted`) across the in-place
  // AuthDialog detour, since `AuthIntent` itself only carries `context`
  // (it must also survive a direct `/login` visit, where no such callback
  // exists to remember).
  const pendingRequestRef = useRef<ComposeRequest | null>(null);

  // Split out from `request` so `handleUnauthorized` can force this branch
  // directly: right after `setUser(null)`, `user` in this render's closure
  // is still the stale signed-in value (the state update has not committed
  // yet), so re-deriving the "signed out" branch from `request(req)` there
  // would wrongly reopen the composer instead of the auth dialog.
  const deferToAuth = useCallback(
    (req: ComposeRequest) => {
      pendingRequestRef.current = req;
      authIntent.setIntent({ type: "compose", context: req.context });
      setAuthDialogOpen(true);
    },
    [authIntent],
  );

  const request = useCallback(
    (req: ComposeRequest) => {
      if (!user) {
        deferToAuth(req);
        return;
      }
      setComposerRequest(req);
    },
    [user, deferToAuth],
  );

  // Resumes composing once signed in, whether that happened via the dialog
  // just now or via a direct `/login` visit that landed back here with the
  // intent still pending (§18.2, steps 4–7). Single consumption point: the
  // intent is always cleared here, and nowhere else.
  useEffect(() => {
    if (!user || authIntent.intent?.type !== "compose") {
      return;
    }
    const pending = pendingRequestRef.current;
    const resumed: ComposeRequest =
      pending && pending.context === authIntent.intent.context
        ? pending
        : { context: authIntent.intent.context };
    pendingRequestRef.current = null;
    setAuthDialogOpen(false);
    authIntent.consumeIntent();
    setComposerRequest(resumed);
  }, [user, authIntent]);

  const closeAuthDialog = (): void => {
    pendingRequestRef.current = null;
    authIntent.consumeIntent();
    setAuthDialogOpen(false);
  };

  const closeComposer = (): void => {
    setComposerRequest(null);
  };

  // The session expired mid-compose (rare): treat it the same as any other
  // logged-out attempt rather than a dead-end `navigate("/login")` that
  // would drop the in-progress destination.
  const handleUnauthorized = (): void => {
    const current = composerRequest;
    setComposerRequest(null);
    setUser(null);
    if (current) {
      deferToAuth(current);
    }
  };

  // Memoized so consumers' own `useCallback`s keyed on `composeController`
  // (FeedScreen, RoomScreen, Timeline, AppShell) don't get a new function
  // identity on every render of this provider — only when `request` itself
  // actually changes (i.e. `user` changing).
  const value = useMemo(() => ({ request }), [request]);

  return (
    <ComposeContext.Provider value={value}>
      {children}

      {composerRequest ? (
        <ComposerDialog
          key={
            composerRequest.context.mode === "new"
              ? `new:${composerRequest.context.roomId}`
              : `${composerRequest.context.mode}:${composerRequest.context.post.id}`
          }
          context={composerRequest.context}
          userProfile={userProfile.profile}
          onClose={closeComposer}
          onUnauthorized={handleUnauthorized}
          onPosted={(post, thread) => {
            composerRequest.onPosted?.(post, thread);
            closeComposer();
          }}
        />
      ) : null}

      {authDialogOpen ? (
        <AuthDialog onClose={closeAuthDialog} onAuthenticated={setUser} />
      ) : null}
    </ComposeContext.Provider>
  );
}

export function useComposeController(): ComposeControllerValue {
  const context = useContext(ComposeContext);
  if (!context) {
    throw new Error("useComposeController must be used within a ComposeControllerProvider");
  }
  return context;
}
