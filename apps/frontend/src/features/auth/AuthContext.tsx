import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { AuthUserDto } from "@brickr/shared";
import { api, isAbortError, toErrorMessage } from "../../services/api-client";

type AuthContextValue = {
  /** `null` while signed out. Distinct from `loading`: a resolved "nobody". */
  user: AuthUserDto | null;
  /** True only until the first `GET /api/auth/session` resolves. */
  loading: boolean;
  error: string | null;
  setUser: (user: AuthUserDto | null) => void;
  reload: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUserDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    // Never rejects with 401 - a signed-out visitor is a normal `null` here,
    // not an error state (CLAUDE.md §66.11).
    api
      .getSession(controller.signal)
      .then(setUser)
      .catch((cause: unknown) => {
        if (!isAbortError(cause)) setError(toErrorMessage(cause));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [reloadToken]);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  return (
    <AuthContext.Provider value={{ user, loading, error, setUser, reload }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
