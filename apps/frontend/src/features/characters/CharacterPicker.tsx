import { useEffect, useMemo, useState } from "react";
import type { CharacterDto } from "@enjo/shared";

import { Avatar } from "../../components/Avatar";
import { Icon } from "../../components/Icon";
import { Spinner } from "../../components/Spinner";
import { truncateProfile } from "./character-utils";

const CHARACTER_PAGE_SIZE = 100;

export type CharacterPickerProps = {
  characters: CharacterDto[];
  loading?: boolean;
  selectedId?: string | null;
  onSelect: (character: CharacterDto) => void;
  onEdit: (character: CharacterDto) => void;
  onOpenList: () => void;
  embedded?: boolean;
};

/**
 * Sidebar list of every character in the simulation.
 * The list stays on the lightweight `CharacterDto`; full settings are fetched
 * only after the user opens the editor.
 */
export function CharacterPicker({
  characters,
  loading = false,
  selectedId,
  onSelect,
  onEdit,
  onOpenList,
  embedded = false,
}: CharacterPickerProps) {
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(CHARACTER_PAGE_SIZE);

  useEffect(() => {
    setVisibleCount(CHARACTER_PAGE_SIZE);
  }, [query]);

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

  const visibleCharacters = visible.slice(0, visibleCount);

  return (
    <section className={embedded ? "bg-surface" : "rounded-2xl border border-line bg-surface"}>
      {!embedded ? <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <button
          type="button"
          onClick={onOpenList}
          title="キャラクター一覧を開く"
          className="flex items-center gap-2 rounded-md text-left text-sm font-semibold text-ink transition hover:text-accent"
        >
          <Icon name="list" className="text-base" />
          キャラクター一覧
        </button>
        <span className="rounded-full bg-surface-raised px-2 py-0.5 text-xs text-ink-muted">
          {characters.length}人
        </span>
      </header> : null}

      <div className="px-3 pt-3">
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
          }}
          placeholder="名前や@handleで絞り込む"
          className="w-full rounded-full border border-line bg-surface-raised px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent/60 focus:outline-none"
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
          {visibleCharacters.map((character) => {
            const isSelected = character.id === selectedId;
            return (
              <li key={character.id}>
                <div
                  className={`flex items-start gap-1 rounded-xl transition ${
                    isSelected
                      ? "bg-accent/12 ring-1 ring-accent/40"
                      : "hover:bg-surface-hover"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(character)}
                    aria-current={isSelected}
                    className="flex min-w-0 flex-1 items-start gap-2.5 px-2 py-2 text-left"
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
                      <span
                        className="mt-0.5 block text-[11px] leading-snug text-ink-muted"
                        title={character.description}
                      >
                        {truncateProfile(character.description)}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onEdit(character)}
                    aria-label={`${character.displayName}の設定を編集`}
                    title="設定を編集"
                    className="m-1 flex h-8 w-8 items-center justify-center rounded-full text-ink-faint transition hover:bg-surface-hover hover:text-ink"
                  >
                    <Icon name="gear" />
                  </button>
                </div>
              </li>
            );
          })}
          {visibleCharacters.length < visible.length ? (
            <li className="px-2 py-3 text-center">
              <button
                type="button"
                onClick={() =>
                  setVisibleCount((current) => current + CHARACTER_PAGE_SIZE)
                }
                className="rounded-full border border-line px-4 py-1.5 text-xs font-semibold text-accent hover:bg-accent/10"
              >
                さらに表示
              </button>
              <p className="mt-1 text-[11px] text-ink-faint">
                {visibleCharacters.length} / {visible.length}人を表示
              </p>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
