import { useCallback, useEffect, useState } from "react";
import type { CharacterDto } from "@brickr/shared";

import { api, isAbortError, toErrorMessage } from "../services/api-client";

export type UseCharactersResult = {
  characters: CharacterDto[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  remove: (ids: string[]) => void;
};

/** Loads the character roster the backend exposes (DTOs only, no prompts). */
export function useCharacters(): UseCharactersResult {
  const [characters, setCharacters] = useState<CharacterDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    setLoading(true);
    setError(null);

    void api
      .getCharacters(controller.signal)
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        setCharacters(loaded);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (cancelled || isAbortError(cause)) {
          return;
        }
        setError(toErrorMessage(cause));
        setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((value) => value + 1);
  }, []);

  const remove = useCallback((ids: string[]) => {
    const removed = new Set(ids);
    setCharacters((current) =>
      current.filter((character) => !removed.has(character.id)),
    );
  }, []);

  return { characters, loading, error, reload, remove };
}
