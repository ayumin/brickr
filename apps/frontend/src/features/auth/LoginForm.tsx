import { useState } from "react";
import type { AuthUserDto } from "@brickr/shared";

import { ErrorBanner } from "../../components/ErrorBanner";
import { TextField } from "../../components/TextField";
import { api, toErrorMessage } from "../../services/api-client";

export type LoginFormProps = {
  /** The signed-in account. The caller decides what happens next (§18.1: shared by the modal and the standalone page, which resume differently). */
  onSuccess: (user: AuthUserDto) => void;
};

/** The login fields + submit, shared by `AuthDialog` and `LoginPage` (Issue #50 / §18.1). */
export function LoginForm({ onSuccess }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !submitting;

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const user = await api.login({ email: email.trim(), password });
      onSuccess(user);
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {error ? (
        <ErrorBanner message="ログインできませんでした" detail={error} onDismiss={() => setError(null)} />
      ) : null}

      <TextField label="メールアドレス" type="email" autoComplete="email" value={email} required onChange={setEmail} />
      <TextField
        label="パスワード"
        type="password"
        autoComplete="current-password"
        value={password}
        required
        onChange={setPassword}
      />

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded-full bg-accent-strong px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "ログイン中…" : "ログイン"}
      </button>
    </form>
  );
}
