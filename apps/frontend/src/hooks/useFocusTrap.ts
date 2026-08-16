import { useEffect, useRef } from "react";
import type { RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

export type UseFocusTrapOptions = {
  onClose: () => void;
  /** When true, Escape does not trigger onClose. */
  closeDisabled?: boolean;
  /** Focused on open instead of the first focusable element. */
  initialFocusRef?: RefObject<HTMLElement | null>;
};

/**
 * Traps keyboard focus inside `containerRef`, handles Escape-to-close, and
 * restores focus to the previously focused element on unmount.
 *
 * Used by both `Dialog` and `SecretResultDialog` so that focus-trap behaviour
 * is maintained in a single place.
 */
export function useFocusTrap<T extends HTMLElement>({
  onClose,
  closeDisabled = false,
  initialFocusRef,
}: UseFocusTrapOptions): RefObject<T | null> {
  const containerRef = useRef<T | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const target =
      initialFocusRef?.current ??
      (containerRef.current ? focusableElements(containerRef.current)[0] : null);
    target?.focus();

    return () => {
      previouslyFocusedRef.current?.focus();
    };
    // Deliberately runs once per mount only: re-running on every re-render
    // would steal focus back from whatever the user just interacted with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  return containerRef;
}
