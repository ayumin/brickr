import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";
import type { RefObject } from "react";

export type MentionInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Fired on Cmd/Ctrl+Enter. */
  onSubmit?: () => void;
  autoFocus?: boolean;
  /** Lets a caller (the composer dialog) focus this element on open (§17.3). */
  inputRef?: RefObject<HTMLTextAreaElement | null>;
};

/**
 * A plain auto-growing textarea with `@handle` typed in directly — no
 * candidate dropdown (Issue #69 / Brickr-ux-refine §10.5). A candidate list
 * would need an API answering "which handles exist and are they cast
 * members", which conflicts with the anonymity requirement (§25): the server
 * resolves whatever `@handle` tokens it recognises after the fact
 * (`resolveKnownMentions`), so the composer itself never needs to know the
 * roster.
 */
export function MentionInput({
  value,
  onChange,
  placeholder,
  disabled = false,
  onSubmit,
  autoFocus = false,
  inputRef,
}: MentionInputProps) {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = inputRef ?? ownRef;

  // The composer dialog opens focused, textarea front and center (§17.3).
  useEffect(() => {
    if (!autoFocus) {
      return;
    }
    const element = textareaRef.current;
    if (!element) {
      return;
    }
    element.focus();
    const end = element.value.length;
    element.setSelectionRange(end, end);
    // Only on mount: re-focusing on every keystroke would fight the caret.
  }, []);

  // Auto-grow so long posts stay readable without an inner scrollbar.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) {
      return;
    }
    element.style.height = "auto";
    element.style.height = `${String(element.scrollHeight)}px`;
  }, [textareaRef, value]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSubmit?.();
    }
  };

  return (
    <textarea
      ref={textareaRef}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      rows={2}
      onChange={(event) => {
        onChange(event.currentTarget.value);
      }}
      onKeyDown={handleKeyDown}
      className="max-h-72 min-h-[76px] w-full resize-none bg-transparent text-[17px] leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none disabled:opacity-50"
    />
  );
}
