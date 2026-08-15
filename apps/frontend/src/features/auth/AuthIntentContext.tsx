import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import type { AuthIntent } from "./auth-intent";

type AuthIntentContextValue = {
  intent: AuthIntent;
  setIntent: (intent: AuthIntent) => void;
  /** Clears the intent. Called exactly once, by whichever screen resumes it (§18.2: "消費後に必ず削除する"). */
  consumeIntent: () => void;
};

const AuthIntentContext = createContext<AuthIntentContextValue | null>(null);

/**
 * Holds the pending auth intent (§18.2) above both branches of `App.tsx`'s
 * top-level `<Routes>` — the compose dialog's "please sign in" flow and a
 * direct `/login`/`/signup` visit both need to read the same value, and
 * `/login`/`/signup` are siblings of `AppShell`, not descendants of it, so
 * this cannot live inside `AppShell` without being lost on that navigation.
 */
export function AuthIntentProvider({ children }: { children: ReactNode }) {
  const [intent, setIntent] = useState<AuthIntent>(null);
  const consumeIntent = useCallback(() => {
    setIntent(null);
  }, []);

  return (
    <AuthIntentContext.Provider value={{ intent, setIntent, consumeIntent }}>
      {children}
    </AuthIntentContext.Provider>
  );
}

export function useAuthIntent(): AuthIntentContextValue {
  const context = useContext(AuthIntentContext);
  if (!context) {
    throw new Error("useAuthIntent must be used within an AuthIntentProvider");
  }
  return context;
}
