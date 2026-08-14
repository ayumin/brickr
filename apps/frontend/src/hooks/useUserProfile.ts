import { useCallback, useEffect, useState } from "react";
import type { UserProfileDto } from "@brickr/shared";
import { api, isAbortError, isUnauthorizedError, toErrorMessage } from "../services/api-client";

// `id`/`handle` are deliberately empty, not the seeded pre-login singleton
// (CLAUDE.md §66.14) - that account is real and owns real posts, so reusing
// its id as a "nobody" placeholder would make a signed-out visitor (or one
// whose profile hasn't loaded yet) appear to own its posts and mentions.
/** Local, not shared: this is a placeholder label, not a real account (§8.2). */
const PLACEHOLDER_DISPLAY_NAME = "あなた";

const DEFAULT_PROFILE: UserProfileDto = {
  id: "",
  handle: "",
  displayName: PLACEHOLDER_DISPLAY_NAME,
  description: "",
};

export function useUserProfile() {
  const [profile, setProfile] = useState<UserProfileDto>(DEFAULT_PROFILE);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    void api
      .getUserProfile(controller.signal)
      .then(setProfile)
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return;
        // Signed out is expected, not broken (CLAUDE.md §66.3 - browsing
        // stays public); showing "failed to load" for it would be alarming
        // and wrong. `profile` is left at its last (placeholder) value.
        if (isUnauthorizedError(cause)) return;
        setError(toErrorMessage(cause));
      });
    return () => controller.abort();
  }, [reloadToken]);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  return { profile, error, reload, setProfile };
}
