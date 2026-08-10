import { useEffect, useMemo, useState } from "react";
import type {
  CharacterConfigDto,
  ModelProfileDto,
  SaveCharacterRequest,
} from "@enjo/shared";

import { ErrorBanner } from "../../components/ErrorBanner";
import { AvatarUploader } from "../../components/AvatarUploader";
import { Spinner } from "../../components/Spinner";
import { api, isAbortError, toErrorMessage } from "../../services/api-client";

const EMPTY_CHARACTER: SaveCharacterRequest = {
  handle: "",
  displayName: "",
  description: "",
  rolePrompt: "",
  tonePrompt: "",
  interests: [],
  activityLevel: 0.5,
  responseProbability: 0.5,
  replyProbability: 0.6,
  quoteProbability: 0.2,
  influence: 0.5,
  modelProfileId: "",
};

type CharacterEditorProps = {
  characterId: string | null;
  onClose: () => void;
  onSaved: (character: CharacterConfigDto) => void;
};

export function CharacterEditor({
  characterId,
  onClose,
  onSaved,
}: CharacterEditorProps) {
  const [form, setForm] = useState<SaveCharacterRequest>(EMPTY_CHARACTER);
  const [interests, setInterests] = useState("");
  const [profiles, setProfiles] = useState<ModelProfileDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const providerIds = useMemo(
    () => [...new Set(profiles.map((profile) => profile.providerId))],
    [profiles],
  );
  const selectedProvider =
    profiles.find((profile) => profile.id === form.modelProfileId)?.providerId ??
    providerIds[0] ??
    "";
  const providerProfiles = useMemo(
    () => profiles.filter((profile) => profile.providerId === selectedProvider),
    [profiles, selectedProvider],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const characterRequest = characterId
      ? api.getCharacterConfig(characterId, controller.signal)
      : Promise.resolve(null);

    void Promise.all([api.getModelProfiles(controller.signal), characterRequest])
      .then(([loadedProfiles, character]) => {
        setProfiles(loadedProfiles);
        if (character) {
          setForm(toRequest(character));
          setInterests(character.interests.join(", "));
        } else {
          setForm({
            ...EMPTY_CHARACTER,
            modelProfileId: loadedProfiles[0]?.id ?? "",
          });
          setInterests("");
        }
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return;
        setError(toErrorMessage(cause));
        setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [characterId]);

  const setText = (
    key: keyof Pick<
      SaveCharacterRequest,
      | "handle"
      | "displayName"
      | "description"
      | "rolePrompt"
      | "tonePrompt"
      | "dialectPrompt"
      | "modelProfileId"
    >,
    value: string,
  ): void => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    const request: SaveCharacterRequest = {
      ...form,
      handle: form.handle.trim().toLowerCase(),
      displayName: form.displayName.trim(),
      description: form.description.trim(),
      rolePrompt: form.rolePrompt.trim(),
      tonePrompt: form.tonePrompt.trim(),
      ...(form.dialectPrompt?.trim()
        ? { dialectPrompt: form.dialectPrompt.trim() }
        : { dialectPrompt: undefined }),
      interests: interests
        .split(/[,、\n]/u)
        .map((interest) => interest.trim())
        .filter((interest, index, all) =>
          interest.length > 0 && all.indexOf(interest) === index,
        ),
      ...(form.avatarUrl?.trim()
        ? { avatarUrl: form.avatarUrl.trim() }
        : { avatarUrl: undefined }),
    };

    try {
      const saved = characterId
        ? await api.updateCharacter(characterId, request)
        : await api.createCharacter(request);
      onSaved(saved);
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/75 p-3 backdrop-blur-sm sm:p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="character-editor-title"
        className="mx-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-line bg-canvas shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-canvas/95 px-4 py-3 backdrop-blur">
          <div>
            <h2 id="character-editor-title" className="font-bold text-ink">
              {characterId ? "キャラクターを編集" : "キャラクターを作成"}
            </h2>
            <p className="text-xs text-ink-faint">
              Persona設定から実際のSystem Promptが組み立てられます
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-full border border-line px-3 py-1 text-xs text-ink-muted hover:text-ink"
          >
            閉じる
          </button>
        </header>

        {loading ? (
          <div className="flex justify-center py-20">
            <Spinner label="設定を読み込み中…" />
          </div>
        ) : (
          <form
            className="space-y-6 p-4 sm:p-6"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {error ? (
              <ErrorBanner
                message="キャラクター設定を保存できませんでした"
                detail={error}
                onDismiss={() => setError(null)}
              />
            ) : null}

            <section className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="表示名"
                value={form.displayName}
                maxLength={80}
                required
                onChange={(value) => setText("displayName", value)}
              />
              <TextField
                label="Handle"
                hint="英小文字・数字・_、最大32文字"
                value={form.handle}
                maxLength={32}
                pattern="[A-Za-z0-9_]+"
                required
                prefix="@"
                onChange={(value) => setText("handle", value)}
              />
              <div className="sm:col-span-2">
                <TextArea
                  label="プロフィール説明"
                  value={form.description}
                  maxLength={500}
                  required
                  rows={2}
                  onChange={(value) => setText("description", value)}
                />
              </div>
              <div className="sm:col-span-2">
                <AvatarUploader
                  value={form.avatarUrl}
                  onChange={(avatarUrl) =>
                    setForm((current) => ({ ...current, avatarUrl }))
                  }
                />
              </div>
            </section>

            <section className="space-y-4 border-t border-line pt-5">
              <div>
                <h3 className="text-sm font-semibold text-ink">Persona / System Prompt</h3>
                <p className="mt-1 text-xs text-ink-faint">
                  共通の安全・文字数ルールはBackendが自動で追加します。
                </p>
              </div>
              <TextArea
                label="性格・立場・考え方"
                value={form.rolePrompt}
                maxLength={4_000}
                required
                rows={7}
                onChange={(value) => setText("rolePrompt", value)}
              />
              <TextArea
                label="話し方・口調"
                value={form.tonePrompt}
                maxLength={4_000}
                required
                rows={5}
                onChange={(value) => setText("tonePrompt", value)}
              />
              <TextArea
                label="方言・言葉づかい（任意）"
                value={form.dialectPrompt ?? ""}
                maxLength={2_000}
                rows={3}
                onChange={(value) => setText("dialectPrompt", value)}
              />
              <TextField
                label="関心分野"
                hint="カンマまたは改行区切り"
                value={interests}
                onChange={setInterests}
              />
            </section>

            <section className="space-y-4 border-t border-line pt-5">
              <div>
                <h3 className="text-sm font-semibold text-ink">LLM</h3>
                <p className="mt-1 text-xs text-ink-faint">
                  APIキーが設定されたProviderのモデルはBackendから自動取得されます。
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm text-ink-muted">
                  Provider
                  <select
                    value={selectedProvider}
                    required
                    onChange={(event) => {
                      const first = profiles.find(
                        (profile) =>
                          profile.providerId === event.currentTarget.value,
                      );
                      if (first) setText("modelProfileId", first.id);
                    }}
                    className="mt-1.5 w-full rounded-xl border border-line bg-surface-raised px-3 py-2 text-ink focus:border-accent/60 focus:outline-none"
                  >
                    {providerIds.map((providerId) => (
                      <option key={providerId} value={providerId}>
                        {providerId}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm text-ink-muted">
                  Model
                  <select
                    value={form.modelProfileId}
                    required
                    onChange={(event) =>
                      setText("modelProfileId", event.currentTarget.value)
                    }
                    className="mt-1.5 w-full rounded-xl border border-line bg-surface-raised px-3 py-2 text-ink focus:border-accent/60 focus:outline-none"
                  >
                    {providerProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.model}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <section className="space-y-4 border-t border-line pt-5">
              <div>
                <h3 className="text-sm font-semibold text-ink">行動傾向</h3>
                <p className="mt-1 text-xs text-ink-faint">0は低く、1は高い設定です。</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <ProbabilityField
                  label="活動量"
                  value={form.activityLevel}
                  onChange={(value) => setForm((current) => ({ ...current, activityLevel: value }))}
                />
                <ProbabilityField
                  label="反応しやすさ"
                  value={form.responseProbability}
                  onChange={(value) =>
                    setForm((current) => ({ ...current, responseProbability: value }))
                  }
                />
                <ProbabilityField
                  label="返信しやすさ"
                  value={form.replyProbability}
                  onChange={(value) => setForm((current) => ({ ...current, replyProbability: value }))}
                />
                <ProbabilityField
                  label="引用しやすさ"
                  value={form.quoteProbability}
                  onChange={(value) => setForm((current) => ({ ...current, quoteProbability: value }))}
                />
                <ProbabilityField
                  label="他Characterへの影響力"
                  value={form.influence}
                  onChange={(value) => setForm((current) => ({ ...current, influence: value }))}
                />
              </div>
            </section>

            <div className="sticky bottom-0 flex justify-end gap-3 border-t border-line bg-canvas/95 py-3 backdrop-blur">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-line px-4 py-2 text-sm text-ink-muted hover:text-ink"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={saving || profiles.length === 0}
                className="rounded-full bg-accent-strong px-5 py-2 text-sm font-semibold text-white hover:bg-accent disabled:opacity-50"
              >
                {saving ? "保存中…" : characterId ? "変更を保存" : "作成する"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function toRequest(character: CharacterConfigDto): SaveCharacterRequest {
  return {
    handle: character.handle,
    displayName: character.displayName,
    description: character.description,
    rolePrompt: character.rolePrompt,
    tonePrompt: character.tonePrompt,
    ...(character.dialectPrompt ? { dialectPrompt: character.dialectPrompt } : {}),
    interests: character.interests,
    activityLevel: character.activityLevel,
    responseProbability: character.responseProbability,
    replyProbability: character.replyProbability,
    quoteProbability: character.quoteProbability,
    influence: character.influence,
    modelProfileId: character.modelProfileId,
    ...(character.avatarUrl ? { avatarUrl: character.avatarUrl } : {}),
  };
}

type TextFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  prefix?: string;
  required?: boolean;
  maxLength?: number;
  pattern?: string;
};

function TextField({ label, value, onChange, hint, prefix, ...input }: TextFieldProps) {
  return (
    <label className="block text-sm text-ink-muted">
      {label}
      <span className="mt-1.5 flex items-center rounded-xl border border-line bg-surface-raised focus-within:border-accent/60">
        {prefix ? <span className="pl-3 text-ink-faint">{prefix}</span> : null}
        <input
          {...input}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-ink focus:outline-none"
        />
      </span>
      {hint ? <span className="mt-1 block text-xs text-ink-faint">{hint}</span> : null}
    </label>
  );
}

type TextAreaProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
  required?: boolean;
  maxLength?: number;
};

function TextArea({ label, value, onChange, ...input }: TextAreaProps) {
  return (
    <label className="block text-sm text-ink-muted">
      {label}
      <textarea
        {...input}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="mt-1.5 w-full resize-y rounded-xl border border-line bg-surface-raised px-3 py-2 text-sm leading-relaxed text-ink focus:border-accent/60 focus:outline-none"
      />
    </label>
  );
}

function ProbabilityField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block rounded-xl border border-line bg-surface p-3 text-sm text-ink-muted">
      <span className="flex justify-between gap-3">
        {label}
        <span className="font-mono text-ink">{value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        className="mt-2 w-full accent-[var(--color-accent)]"
      />
    </label>
  );
}
