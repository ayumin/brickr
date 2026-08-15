import type { ReactNode } from "react";

import { BrandLogo } from "../../components/BrandLogo";

export type AuthPageShellProps = {
  heading: ReactNode;
  tagline?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
};

/**
 * The chrome shared by `/login` and `/signup` (§18.1): logo, app name, the
 * card the form sits in, and a footer slot for the cross-link. Extracted so
 * both pages use identical Brickr Dark/Light styling instead of two
 * hand-maintained copies.
 */
export function AuthPageShell({ heading, tagline, children, footer }: AuthPageShellProps) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <BrandLogo className="h-10 w-10" />
          <div>
            <h1 className="text-lg font-display font-bold text-ink">{heading}</h1>
            {tagline ? <p className="text-xs text-ink-faint">{tagline}</p> : null}
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-6">{children}</div>

        <p className="text-center text-sm text-ink-muted">{footer}</p>
      </div>
    </div>
  );
}
