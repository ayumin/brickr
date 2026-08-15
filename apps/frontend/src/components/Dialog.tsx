import { useEffect, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { Icon } from "./Icon";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

export type DialogProps = {
  titleId: string;
  title: ReactNode;
  onClose: () => void;
  /** True while submitting: Escape and a backdrop click no longer close it (§17.3). */
  closeDisabled?: boolean;
  /** Focused on open instead of the first focusable element (§17.3: the textarea). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Covers the full viewport on narrow screens instead of a centered card (§17.3). */
  fullScreenOnMobile?: boolean;
  /**
   * `"bottom-sheet"` anchors the panel to the bottom edge with a rounded top
   * and safe-area padding (§19.2's mobile room-info sheet) instead of a
   * centered card. Mutually exclusive with `fullScreenOnMobile` — a
   * bottom-sheet caller is mobile-only to begin with (rendered behind the
   * same `lg:hidden` split as `MobileNavigation`), so there is no separate
   * desktop variant to fall back to here.
   */
  placement?: "center" | "bottom-sheet";
  children: ReactNode;
};

/**
 * The one accessible modal shell shared by `ComposerDialog`, `AuthDialog`,
 * `RoomNameDialog` and `RoomInfoSheet` (Issue #50 / "common modal"):
 * `role=dialog`, a focus trap, Escape-to-close, backdrop-click-to-close,
 * initial focus, and focus restored to whatever triggered it on close
 * (§17.3). Older ad-hoc dialogs in this codebase predate this and are left
 * alone.
 */
export function Dialog({
  titleId,
  title,
  onClose,
  closeDisabled = false,
  initialFocusRef,
  fullScreenOnMobile = false,
  placement = "center",
  children,
}: DialogProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const isBottomSheet = placement === "bottom-sheet";

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const target = initialFocusRef?.current ?? (containerRef.current ? focusableElements(containerRef.current)[0] : null);
    target?.focus();

    return () => {
      previouslyFocusedRef.current?.focus();
    };
    // Deliberately runs once per mount only: re-running on every re-render
    // would steal focus back from whatever the user just interacted with.
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        if (closeDisabled) return;
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
  }, [closeDisabled, onClose]);

  return (
    <div
      className={`fixed inset-0 z-50 flex bg-black/70 backdrop-blur-sm ${
        isBottomSheet
          ? "items-end justify-center"
          : fullScreenOnMobile
            ? "items-stretch justify-stretch sm:items-center sm:justify-center sm:p-4"
            : "items-center justify-center p-4"
      }`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !closeDisabled) onClose();
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`flex w-full flex-col overflow-y-auto border-line bg-surface shadow-2xl ${
          isBottomSheet
            ? "max-h-[85vh] rounded-t-2xl border-t"
            : fullScreenOnMobile
              ? "h-full max-w-full rounded-none border-0 sm:h-auto sm:max-h-[85vh] sm:max-w-lg sm:rounded-2xl sm:border"
              : "max-h-[85vh] max-w-lg rounded-2xl border"
        }`}
        style={isBottomSheet ? { paddingBottom: "env(safe-area-inset-bottom)" } : undefined}
      >
        {isBottomSheet ? (
          <div className="flex shrink-0 justify-center py-2" aria-hidden="true">
            <span className="h-1 w-10 rounded-full bg-line-strong" />
          </div>
        ) : null}

        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 id={titleId} className="min-w-0 truncate text-base font-bold text-ink">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={closeDisabled}
            aria-label="閉じる"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-muted transition hover:bg-surface-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon name="x-lg" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
