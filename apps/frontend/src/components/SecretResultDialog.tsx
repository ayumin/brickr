import { useEffect, useRef, useState } from "react";

import { Icon } from "./Icon";

export type SecretResult = { title: string; value: string };

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/**
 * Shown exactly once (CLAUDE.md §66.10): the invite code or temporary
 * password is never retrievable again after this, so closing requires an
 * explicit click rather than a background click that could happen by accident.
 * Deliberately does not use the shared `Dialog` (its backdrop-click-to-close
 * would violate that "explicit click only" requirement), but still needs the
 * same keyboard accessibility as `Dialog`: a focus trap, Escape-to-close, and
 * focus restored to the trigger on close (§27).
 *
 * Shared by `UserManagementList` (reset-password) and `InviteSettings`
 * (invite code) — both surface a one-time secret the same way.
 */
export function SecretResultDialog({
  result,
  onClose,
}: {
  result: SecretResult;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const target = containerRef.current ? focusableElements(containerRef.current)[0] : null;
    target?.focus();

    return () => {
      previouslyFocusedRef.current?.focus();
    };
    // Deliberately runs once per mount only, matching Dialog.tsx's rationale.
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const container = containerRef.current;
      if (!container) return;
      const elements = focusableElements(container);
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !container.contains(active)) {
          event.preventDefault();
          last?.focus();
        }
      } else if (active === last || !container.contains(active)) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="secret-result-title"
        className="relative w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl"
      >
        <h2 id="secret-result-title" className="text-base font-bold text-ink">
          {result.title}
        </h2>
        <p className="mt-2 text-xs text-ink-muted">
          この値は今だけ表示されます。担当のUserへ別の手段で伝えてください。
        </p>
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-line bg-surface-raised px-3 py-2">
          <code className="min-w-0 flex-1 break-all text-sm text-ink">{result.value}</code>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard
                .writeText(result.value)
                .then(() => {
                  setCopyError(false);
                  setCopied(true);
                })
                .catch(() => {
                  setCopied(false);
                  setCopyError(true);
                });
            }}
            aria-label="コピー"
            title="コピー"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-muted transition hover:bg-surface-hover hover:text-ink"
          >
            <Icon name="clipboard" />
          </button>
        </div>
        {copied ? <p className="mt-1.5 text-xs text-accent">コピーしました。</p> : null}
        {copyError ? (
          <p className="mt-1.5 text-xs text-danger">
            コピーできませんでした。値を選択して手動でコピーしてください。
          </p>
        ) : null}
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-accent-strong px-4 py-2 text-sm font-semibold text-white hover:bg-accent"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
