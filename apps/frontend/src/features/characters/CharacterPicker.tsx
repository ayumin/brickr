import { useMemo, useState } from "react";
import type { CharacterDto } from "@enjo/shared";

import { Avatar } from "../../components/Avatar";
import { Spinner } from "../../components/Spinner";

export type CharacterPickerProps = {
  characters: CharacterDto[];
  loading?: boolean;
  selectedId?: string | null;
  onSelect: (character: CharacterDto) => void;
};

/**
 * Sidebar list of every character in the simulation.
 * Only fields present on `CharacterDto` are shown — prompts, probabilities and
 * model profiles are intentionally not sent to the frontend (CLAUDE.md §47).
 */
export function CharacterPicker({
  characters,
  loading = false,
  selectedId,
  onSelect,
}: CharacterPickerProps) {
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) {
      return characters;
    }
    return characters.filter(
      (character) =>
        character.handle.toLowerCase().includes(needle) ||
        character.displayName.toLowerCase().includes(needle) ||
        character.description.toLowerCase().includes(needle),
    );
  }, [characters, query]);

  return (
    <section className="rounded-2xl border border-line bg-surface">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">キャラクター</h2>
        <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-ink-muted">
          {characters.length}人
        </span>
      </header>

      <div className="px-3 pt-3">
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
          }}
          placeholder="名前や@handleで絞り込む"
          className="w-full rounded-full border border-line bg-black/25 px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent/60 focus:outline-none"
        />
      </div>

      {loading && characters.length === 0 ? (
        <div className="flex justify-center px-4 py-8">
          <Spinner size="sm" label="読み込み中…" />
        </div>
      ) : visible.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-muted">
          該当するキャラクターがいません。
        </p>
      ) : (
        <ul className="max-h-[60vh] overflow-y-auto p-2 lg:max-h-[calc(100dvh-16rem)]">
          {visible.map((character) => {
            const isSelected = character.id === selectedId;
            return (
              <li key={character.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(character);
                  }}
                  aria-current={isSelected}
                  className={`flex w-full items-start gap-2.5 rounded-xl px-2 py-2 text-left transition ${
                    isSelected
                      ? "bg-accent/12 ring-1 ring-accent/40"
                      : "hover:bg-surface-hover"
                  }`}
                >
                  <Avatar
                    handle={character.handle}
                    displayName={character.displayName}
                    avatarUrl={character.avatarUrl}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <span className="truncate text-sm font-semibold text-ink">
                        {character.displayName}
                      </span>
                      <span className="truncate text-xs text-ink-faint">
                        @{character.handle}
                      </span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-ink-muted">
                      {character.description}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
