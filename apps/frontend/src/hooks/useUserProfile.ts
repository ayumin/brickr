import { useCallback, useEffect, useState } from "react";
import {
  USER_AUTHOR_ID,
  USER_DISPLAY_NAME,
  USER_HANDLE,
  type UserProfileDto,
} from "@brickr/shared";
import { api, isAbortError, isUnauthorizedError, toErrorMessage } from "../services/api-client";

const DEFAULT_PROFILE: UserProfileDto = {
  id: USER_AUTHOR_ID,
  handle: USER_HANDLE,
  displayName: USER_DISPLAY_NAME,
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
