import { useState } from "react";
import type { AuthUserDto } from "@brickr/shared";

import { Dialog } from "../../components/Dialog";
import { LoginForm } from "./LoginForm";
import { SignupForm } from "./SignupForm";

export type AuthDialogProps = {
  onClose: () => void;
  onAuthenticated: (user: AuthUserDto) => void;
};

/**
 * The "please sign in" overlay a logged-out compose attempt opens (§18,
 * Issue #50). Shares `LoginForm`/`SignupForm` with the standalone `/login`
 * and `/signup` pages (§18.1) — only the chrome differs (a dialog toggling
 * between the two forms in place, instead of a page-to-page link), so
 * validation and submit logic exist exactly once.
 *
 * Resuming whatever was being composed is not this component's job: it only
 * reports a signed-in user upward. `ComposeContext` reacts to `user` changing
 * and reopens the composer from the still-pending auth intent (§18.2).
 */
export function AuthDialog({ onClose, onAuthenticated }: AuthDialogProps) {
  const [mode, setMode] = useState<"login" | "signup">("login");

  return (
    <Dialog titleId="auth-dialog-title" title={mode === "login" ? "ログイン" : "新規登録"} onClose={onClose}>
      <div className="px-4 py-3">
        {mode === "login" ? <LoginForm onSuccess={onAuthenticated} /> : <SignupForm onSuccess={onAuthenticated} />}

        <p className="mt-4 text-center text-sm text-ink-muted">
          {mode === "login" ? (
            <>
              招待コードをお持ちですか？{" "}
              <button
                type="button"
                onClick={() => setMode("signup")}
                className="font-semibold text-accent hover:underline"
              >
                新規登録
              </button>
            </>
          ) : (
            <>
              すでにアカウントをお持ちですか？{" "}
              <button
                type="button"
                onClick={() => setMode("login")}
                className="font-semibold text-accent hover:underline"
              >
                ログイン
              </button>
            </>
          )}
        </p>
      </div>
    </Dialog>
  );
}
