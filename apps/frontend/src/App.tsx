import { Route, Routes } from "react-router-dom";

import { AppShell } from "./app/AppShell";
import { SessionGate } from "./app/SessionGate";
import { AuthProvider } from "./features/auth/AuthContext";
import { AuthIntentProvider } from "./features/auth/AuthIntentContext";
import { LoginPage } from "./features/auth/LoginPage";
import { SignupPage } from "./features/auth/SignupPage";

export default function App() {
  return (
    <AuthProvider>
      {/* Above the `<Routes>`, not inside `AppShell`: a pending compose
          intent (§18.2) must survive navigating to `/login`/`/signup`, which
          are siblings of `AppShell` here, not descendants of it. */}
      <AuthIntentProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          {/* Everything else is AppShell's hybrid persistent-screen tree
              (see app/AppShell.tsx and app/AppRoutes.tsx) rather than a
              single flat <Route> per view. */}
          <Route
            path="*"
            element={
              <SessionGate>
                <AppShell />
              </SessionGate>
            }
          />
        </Routes>
      </AuthIntentProvider>
    </AuthProvider>
  );
}
