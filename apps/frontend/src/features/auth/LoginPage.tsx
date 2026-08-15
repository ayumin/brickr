import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";

import { APP_FULL_NAME, APP_TAGLINE } from "../../brand";
import { AuthPageShell } from "./AuthPageShell";
import { useAuth } from "./AuthContext";
import { useAuthIntent } from "./AuthIntentContext";
import { composerContextLandingPath } from "./auth-intent";
import { LoginForm } from "./LoginForm";

/**
 * The standalone `/login` route (§18.1: same `LoginForm` the `AuthDialog`
 * uses). A pending compose intent is only ever set by the dialog flow, but a
 * visitor can always reach this page directly too — reading it here (without
 * consuming it) picks the right landing spot either way (§18.2: "直接
 * `/login`を開いた場合...compose intentがある場合だけ投稿を再開する"), while
 * `ComposeContext` remains the single place that actually consumes it and
 * reopens the composer once `AppShell` mounts.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const { user, loading, setUser } = useAuth();
  const { intent } = useAuthIntent();

  // Signing in a second time should just land back home, not show the form.
  useEffect(() => {
    if (!loading && user) navigate("/", { replace: true });
  }, [loading, user, navigate]);

  return (
    <AuthPageShell
      heading={APP_FULL_NAME}
      tagline={APP_TAGLINE}
      footer={
        <>
          招待コードをお持ちですか？{" "}
          <Link to="/signup" className="font-semibold text-accent hover:underline">
            新規登録
          </Link>
        </>
      }
    >
      <LoginForm
        onSuccess={(signedInUser) => {
          setUser(signedInUser);
          const target = intent?.type === "compose" ? composerContextLandingPath(intent.context) : "/";
          navigate(target, { replace: true });
        }}
      />
    </AuthPageShell>
  );
}
