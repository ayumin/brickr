import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, SyntheticEvent } from "react";
import type { CharacterDto } from "@enjo/shared";

import { Avatar } from "../../components/Avatar";

const MAX_SUGGESTIONS = 6;

type ActiveMention = {
  /** Index of the `@` inside the current value. */
  start: number;
  /** Text typed after the `@`, possibly empty. */
  query: string;
};

/**
 * Detect an `@…` token the caret is currently sitting in.
 * Only triggers at the start of the text or after whitespace / an open bracket,
 * so email-ish text does not open the dropdown.
 */
function detectMention(value: string, caret: number): ActiveMention | null {
  const before = value.slice(0, caret);
  const match = /(?:^|[\s(（「『【])@([A-Za-z0-9_]*)$/.exec(before);
  if (!match) {
    return null;
  }
  const query = match[1] ?? "";
  return { start: caret - query.length - 1, query };
}

export type MentionInputProps = {
  value: string;
  onChange: (value: string) => void;
  characters: CharacterDto[];
  placeholder?: string;
  disabled?: boolean;
  /** Fired on Cmd/Ctrl+Enter. */
  onSubmit?: () => void;
  /** Smaller variant used by the inline reply composer. */
  compact?: boolean;
  autoFocus?: boolean;
};

export function MentionInput({
  value,
  onChange,
  characters,
  placeholder,
  disabled = false,
  onSubmit,
  compact = false,
  autoFocus = false,
}: MentionInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<ActiveMention | null>(null);
  const [highlight, setHighlight] = useState(0);

  const suggestions = useMemo(() => {
    if (!mention) {
      return [];
    }
    const query = mention.query.toLowerCase();
    return characters
      .filter((character) => {
        if (query.length === 0) {
          return true;
        }
        return (
          character.handle.toLowerCase().includes(query) ||
          character.displayName.toLowerCase().includes(query)
        );
      })
      .slice(0, MAX_SUGGESTIONS);
  }, [mention, characters]);

  const isOpen = mention !== null && suggestions.length > 0;

  // The inline composer opens focused, right where the user clicked 返信.
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
  }, [autoFocus]);

  // Auto-grow so long posts stay readable without an inner scrollbar.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) {
      return;
    }
    element.style.height = "auto";
    element.style.height = `${String(element.scrollHeight)}px`;
  }, [value]);

  const syncMention = (element: HTMLTextAreaElement): void => {
    const caret = element.selectionStart ?? element.value.length;
    setMention(detectMention(element.value, caret));
    setHighlight(0);
  };

  const insertMention = (handle: string): void => {
    if (!mention) {
      return;
    }
    const before = value.slice(0, mention.start);
    const after = value.slice(mention.start + 1 + mention.query.length);
    const inserted = `@${handle}${after.startsWith(" ") ? "" : " "}`;
    const next = `${before}${inserted}${after}`;
    const caret = before.length + inserted.length;

    onChange(next);
    setMention(null);
    setHighlight(0);

    requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (!element) {
        return;
      }
      element.focus();
      element.setSelectionRange(caret, caret);
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (isOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlight((current) => (current + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlight(
          (current) => (current - 1 + suggestions.length) % suggestions.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const selected = suggestions[highlight] ?? suggestions[0];
        if (selected) {
          event.preventDefault();
          insertMention(selected.handle);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMention(null);
        return;
      }
    }

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSubmit?.();
    }
  };

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        rows={compact ? 1 : 2}
        onChange={(event) => {
          onChange(event.currentTarget.value);
          syncMention(event.currentTarget);
        }}
        onSelect={(event: SyntheticEvent<HTMLTextAreaElement>) => {
          syncMention(event.currentTarget);
        }}
        onBlur={() => {
          setMention(null);
        }}
        onKeyDown={handleKeyDown}
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls="mention-suggestions"
        className={`w-full resize-none bg-transparent leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none disabled:opacity-50 ${
          compact
            ? "max-h-40 min-h-[42px] text-[15px]"
            : "max-h-72 min-h-[76px] text-[17px]"
        }`}
      />

      {isOpen ? (
        <ul
          id="mention-suggestions"
          role="listbox"
          className="absolute left-0 z-20 mt-1 max-h-72 w-full max-w-sm overflow-y-auto rounded-xl border border-line bg-surface-raised shadow-2xl shadow-black/60"
        >
          {suggestions.map((character, index) => (
            <li key={character.id} role="none">
              <button
                type="button"
                role="option"
                aria-selected={index === highlight}
                // Keep focus in the textarea so onBlur does not close us first.
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onMouseEnter={() => {
                  setHighlight(index);
                }}
                onClick={() => {
                  insertMention(character.handle);
                }}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition ${
                  index === highlight ? "bg-accent/15" : "hover:bg-surface-hover"
                }`}
              >
                <Avatar
                  handle={character.handle}
                  displayName={character.displayName}
                  avatarUrl={character.avatarUrl}
                  size="sm"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">
                    {character.displayName}
                  </span>
                  <span className="block truncate text-xs text-ink-faint">
                    @{character.handle}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
