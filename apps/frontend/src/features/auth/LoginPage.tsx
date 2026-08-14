import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { APP_FULL_NAME, APP_TAGLINE } from "../../brand";
import { BrandLogo } from "../../components/BrandLogo";
import { ErrorBanner } from "../../components/ErrorBanner";
import { TextField } from "../../components/TextField";
import { api, toErrorMessage } from "../../services/api-client";
import { useAuth } from "./AuthContext";

export function LoginPage() {
  const navigate = useNavigate();
  const { user, loading, setUser } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Signing in a second time should just land back home, not show the form.
  useEffect(() => {
    if (!loading && user) navigate("/", { replace: true });
  }, [loading, user, navigate]);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !submitting;

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const signedInUser = await api.login({ email: email.trim(), password });
      setUser(signedInUser);
      navigate("/");
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <BrandLogo className="h-10 w-10" />
          <div>
            <h1 className="text-lg font-display font-bold text-ink">{APP_FULL_NAME}</h1>
            <p className="text-xs text-ink-faint">{APP_TAGLINE}</p>
          </div>
        </div>

        <form
          className="space-y-4 rounded-2xl border border-line bg-surface p-6"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {error ? (
            <ErrorBanner
              message="ログインできませんでした"
              detail={error}
              onDismiss={() => setError(null)}
            />
          ) : null}

          <TextField
            label="メールアドレス"
            type="email"
            autoComplete="email"
            value={email}
            required
            onChange={setEmail}
          />
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

        <p className="text-center text-sm text-ink-muted">
          招待コードをお持ちですか？{" "}
          <Link to="/signup" className="font-semibold text-accent hover:underline">
            新規登録
          </Link>
        </p>
      </div>
    </div>
  );
}
