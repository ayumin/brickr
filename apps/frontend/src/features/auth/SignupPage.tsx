import { useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { APP_FULL_NAME } from "../../brand";
import { AuthPageShell } from "./AuthPageShell";
import { useAuth } from "./AuthContext";
import { useAuthIntent } from "./AuthIntentContext";
import { composerContextLandingPath } from "./auth-intent";
import { SignupForm } from "./SignupForm";

/** The standalone `/signup` route (§18.1: same `SignupForm` the `AuthDialog` uses). See `LoginPage` for the auth-intent redirect rationale. */
export function SignupPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading, setUser } = useAuth();
  const { intent } = useAuthIntent();
  const initialInviteCode = searchParams.get("inviteCode") ?? "";

  useEffect(() => {
    if (!loading && user) navigate("/", { replace: true });
  }, [loading, user, navigate]);

  return (
    <AuthPageShell
      heading={`${APP_FULL_NAME}に登録`}
      footer={
        <>
          すでにアカウントをお持ちですか？{" "}
          <Link to="/login" className="font-semibold text-accent hover:underline">
            ログイン
          </Link>
        </>
      }
    >
      <SignupForm
        initialInviteCode={initialInviteCode}
        onSuccess={(signedUpUser) => {
          setUser(signedUpUser);
          const target = intent?.type === "compose" ? composerContextLandingPath(intent.context) : "/";
          navigate(target, { replace: true });
        }}
      />
    </AuthPageShell>
  );
}
