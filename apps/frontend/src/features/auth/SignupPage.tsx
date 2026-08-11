import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { SignupRequest } from "@brickr/shared";

import { APP_FULL_NAME } from "../../brand";
import { BrandLogo } from "../../components/BrandLogo";
import { ErrorBanner } from "../../components/ErrorBanner";
import { TextField } from "../../components/TextField";
import { api, toErrorMessage } from "../../services/api-client";
import { useAuth } from "./AuthContext";
import { validateSignupForm } from "./auth-utils";

type FormState = {
  inviteCode: string;
  email: string;
  password: string;
  handle: string;
  displayName: string;
  birthdate: string;
  description: string;
  country: string;
  region: string;
  interests: string;
  occupation: string;
  xHandle: string;
};

const EMPTY_FORM: FormState = {
  inviteCode: "",
  email: "",
  password: "",
  handle: "",
  displayName: "",
  birthdate: "",
  description: "",
  country: "",
  region: "",
  interests: "",
  occupation: "",
  xHandle: "",
};

function toSignupRequest(form: FormState): SignupRequest {
  const interests = form.interests
    .split(/[,、\n]/u)
    .map((interest) => interest.trim())
    .filter((interest, index, all) => interest.length > 0 && all.indexOf(interest) === index);

  return {
    inviteCode: form.inviteCode.trim(),
    email: form.email.trim(),
    password: form.password,
    handle: form.handle.trim().toLowerCase(),
    displayName: form.displayName.trim(),
    birthdate: form.birthdate,
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
    ...(form.country.trim() ? { country: form.country.trim() } : {}),
    ...(form.region.trim() ? { region: form.region.trim() } : {}),
    ...(interests.length > 0 ? { interests } : {}),
    ...(form.occupation.trim() ? { occupation: form.occupation.trim() } : {}),
    ...(form.xHandle.trim() ? { xHandle: form.xHandle.trim() } : {}),
  };
}

export function SignupPage() {
  const navigate = useNavigate();
  const { user, loading, setUser } = useAuth();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) navigate("/", { replace: true });
  }, [loading, user, navigate]);

  const setField = (key: keyof FormState) => (value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  // The acceptance criterion names this field specifically: signup must be
  // unsubmittable without one, not merely rejected after a round trip.
  const canSubmit = form.inviteCode.trim().length > 0 && !submitting;

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    // Checked here rather than only via `required` inputs, so an empty
    // invite code is rejected with the same explicit message regardless of
    // which field the browser happens to focus first.
    const problem = validateSignupForm(form);
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const signedUpUser = await api.signup(toSignupRequest(form));
      setUser(signedUpUser);
      navigate("/");
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <BrandLogo className="h-10 w-10" />
          <h1 className="text-lg font-bold text-ink">{APP_FULL_NAME}に登録</h1>
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
              message="登録できませんでした"
              detail={error}
              onDismiss={() => setError(null)}
            />
          ) : null}

          <TextField
            label="招待コード"
            value={form.inviteCode}
            required
            onChange={setField("inviteCode")}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="メールアドレス"
              type="email"
              autoComplete="email"
              value={form.email}
              required
              onChange={setField("email")}
            />
            <TextField
              label="パスワード"
              type="password"
              autoComplete="new-password"
              hint={`${String(MIN_PASSWORD_LENGTH)}文字以上`}
              value={form.password}
              required
              onChange={setField("password")}
            />
            <TextField
              label="ハンドル"
              prefix="@"
              hint="半角英小文字・数字・_、3〜32文字"
              value={form.handle}
              required
              onChange={setField("handle")}
            />
            <TextField
              label="表示名"
              value={form.displayName}
              required
              onChange={setField("displayName")}
            />
            <TextField
              label="生年月日"
              type="date"
              value={form.birthdate}
              required
              onChange={setField("birthdate")}
            />
          </div>

          <div className="space-y-4 border-t border-line pt-4">
            <p className="text-xs text-ink-faint">以下は任意項目です。</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="国" value={form.country} onChange={setField("country")} />
              <TextField
                label="地域（都道府県 / 州）"
                value={form.region}
                onChange={setField("region")}
              />
              <TextField label="職業" value={form.occupation} onChange={setField("occupation")} />
              <TextField
                label="X (Twitter) ハンドル"
                prefix="@"
                value={form.xHandle}
                onChange={setField("xHandle")}
              />
              <div className="sm:col-span-2">
                <TextField
                  label="関心分野"
                  hint="カンマまたは改行区切り"
                  value={form.interests}
                  onChange={setField("interests")}
                />
              </div>
              <div className="sm:col-span-2">
                <TextField
                  label="自己紹介"
                  value={form.description}
                  onChange={setField("description")}
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full rounded-full bg-accent-strong px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "登録中…" : "登録する"}
          </button>
        </form>

        <p className="text-center text-sm text-ink-muted">
          すでにアカウントをお持ちですか？{" "}
          <Link to="/login" className="font-semibold text-accent hover:underline">
            ログイン
          </Link>
        </p>
      </div>
    </div>
  );
}
