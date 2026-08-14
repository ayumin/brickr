import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CharacterDto } from "@brickr/shared";

import { useCharacters } from "../../hooks/useCharacters";
import { handlePath } from "../../routes";
import { useAuth } from "../auth/AuthContext";
import { CharacterEditor } from "../characters/CharacterEditor";
import { CharacterList } from "../characters/CharacterList";

/**
 * The cast (character) management list (§6.1, §20) - login required,
 * ordinary mount/unmount screen (§13.5). Wraps the existing, already-complete
 * CharacterList/CharacterEditor; only the data source (its own lazy fetch,
 * per §13.2 "キャスト一覧：/castでlazy fetch" - no more app-bootstrap
 * `useCharacters()`) and "open timeline" (now the shared public profile,
 * not an in-room view) are new here.
 */
export function CastManagementScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { characters, loading, reload, remove } = useCharacters();
  const [editor, setEditor] = useState<{ characterId: string | null } | null>(null);

  const openTimeline = (character: CharacterDto) => navigate(handlePath(character.handle));

  return (
    <div className="mx-auto w-full max-w-5xl">
      <header className="border-b border-line px-4 py-3">
        <h1 className="font-display text-lg font-bold text-ink">キャスト</h1>
      </header>

      <CharacterList
        characters={characters}
        currentUserId={user?.id ?? ""}
        isAdmin={user?.isAdmin ?? false}
        loading={loading}
        onCreate={() => setEditor({ characterId: null })}
        onEdit={(character) => setEditor({ characterId: character.id })}
        onOpenTimeline={openTimeline}
        onDeleted={remove}
        onCreated={reload}
      />

      {editor ? (
        <CharacterEditor
          characterId={editor.characterId}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}
