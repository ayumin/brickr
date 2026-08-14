import { describe, expect, it } from "vitest";
import type { ModelProfileRepository } from "../model-profiles/model-profile-repository.js";
import type { ModelProfile } from "../model-profiles/model-profile.js";
import type { CharacterRepository } from "./character-repository.js";
import { CHARACTER_CSV_HEADERS, CharacterCsvError, exportCharactersCsv, parseCharactersCsv } from "./character-csv.js";
import type { CharacterPersonaGenerator } from "./character-generator.js";
import { CharacterService } from "./character-service.js";
import type { Character, SaveCharacter } from "./character.js";

/**
 * These tests exercise `CharacterService.exportCsv`/`importCsv` — the
 * orchestration around the pure `character-csv.ts` functions (which
 * `character-csv.test.ts` already covers): the id/handle cross-match check,
 * the blank-id-to-UUID fallback, created/updated accounting, the
 * missing-model-profile collection, and the importMany failure wrap. None of
 * this had a test before, so it doubles as the guard for a later extraction
 * of this orchestration into its own module.
 */

const PROFILE: ModelProfile = { id: "openai-default", providerId: "openai", model: "gpt-test" };

function makeCharacter(id: string, handle: string, overrides: Partial<Character> = {}): Character {
  return {
    id,
    handle,
    displayName: `Character ${id}`,
    description: "desc",
    rolePrompt: "role",
    tonePrompt: "tone",
    interests: ["test"],
    activityLevel: 0.5,
    responseProbability: 0.5,
    replyProbability: 0.5,
    quoteProbability: 0.5,
    influence: 0.5,
    modelProfileId: PROFILE.id,
    ...overrides,
  };
}

type ImportManyEntry = { id: string; input: SaveCharacter; isDeleted: boolean };

function makeService(options: {
  characters?: Character[];
  profiles?: ModelProfile[];
  postCounts?: Map<string, number>;
  importMany?: (entries: ImportManyEntry[]) => Promise<void>;
} = {}) {
  const characters = options.characters ?? [];
  const profiles = options.profiles ?? [PROFILE];
  const postCounts = options.postCounts ?? new Map<string, number>();
  const ensureAllCalls: ModelProfile[][] = [];
  const importManyCalls: ImportManyEntry[][] = [];

  const characterRepository = {
    findAllIncludingDeleted: (): Promise<Character[]> => Promise.resolve([...characters]),
    countPostsByCharacterIds: (ids: string[]): Promise<Map<string, number>> =>
      Promise.resolve(new Map(ids.map((id) => [id, postCounts.get(id) ?? 0]))),
    importMany: (entries: ImportManyEntry[]): Promise<void> => {
      importManyCalls.push(entries);
      return options.importMany ? options.importMany(entries) : Promise.resolve();
    },
  } as unknown as CharacterRepository;

  const modelProfileRepository = {
    findAll: (): Promise<ModelProfile[]> => Promise.resolve([...profiles]),
    ensureAll: (added: readonly ModelProfile[]): Promise<void> => {
      ensureAllCalls.push([...added]);
      return Promise.resolve();
    },
  } as unknown as ModelProfileRepository;

  const personaGenerator = {} as CharacterPersonaGenerator;

  return {
    service: new CharacterService(characterRepository, modelProfileRepository, personaGenerator),
    ensureAllCalls,
    importManyCalls,
  };
}

function csvRow(fields: {
  id?: string;
  handle: string;
  displayName?: string;
  modelProfileId?: string;
  providerId?: string;
  model?: string;
}): string[] {
  return [
    fields.id ?? "",
    fields.handle,
    fields.displayName ?? "Character",
    "desc",
    "",
    "role",
    "tone",
    "",
    JSON.stringify(["test"]),
    "0.5",
    "0.5",
    "0.5",
    "0.5",
    "0.5",
    fields.modelProfileId ?? PROFILE.id,
    fields.providerId ?? PROFILE.providerId,
    fields.model ?? PROFILE.model,
    "0",
    "FALSE",
  ];
}

function buildCsv(rows: string[][]): string {
  const cell = (value: string): string =>
    /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  const lines = [CHARACTER_CSV_HEADERS.join(","), ...rows.map((row) => row.map(cell).join(","))];
  return `\uFEFF${lines.join("\r\n")}`;
}

describe("CharacterService.importCsv", () => {
  it("round-trips an exported CSV back through import as an update", async () => {
    const existing = makeCharacter("char-1", "existing1");
    const { service } = makeService({ characters: [existing], profiles: [PROFILE] });
    const csv = exportCharactersCsv([existing], new Map([[PROFILE.id, PROFILE]]), new Map());

    await expect(service.importCsv(csv)).resolves.toEqual({
      importedCount: 1,
      createdCount: 0,
      updatedCount: 1,
    });
  });

  it("rejects a row whose id and handle point at two different existing characters", async () => {
    const a = makeCharacter("char-a", "alpha");
    const b = makeCharacter("char-b", "beta");
    const { service } = makeService({ characters: [a, b], profiles: [PROFILE] });
    const csv = buildCsv([csvRow({ id: "char-a", handle: "beta" })]);

    await expect(service.importCsv(csv)).rejects.toBeInstanceOf(CharacterCsvError);
  });

  it("generates a UUID when the CSV row's id is blank", async () => {
    const { service, importManyCalls } = makeService({ characters: [], profiles: [PROFILE] });
    const csv = buildCsv([csvRow({ handle: "newhandle" })]);

    const result = await service.importCsv(csv);

    expect(result).toEqual({ importedCount: 1, createdCount: 1, updatedCount: 0 });
    expect(importManyCalls[0]?.[0]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
    );
  });

  it("reports createdCount and updatedCount correctly for a mixed batch", async () => {
    const existing = makeCharacter("char-1", "existing1");
    const { service } = makeService({ characters: [existing], profiles: [PROFILE] });
    const csv = buildCsv([
      csvRow({ id: "char-1", handle: "existing1" }),
      csvRow({ handle: "brandnew" }),
    ]);

    await expect(service.importCsv(csv)).resolves.toEqual({
      importedCount: 2,
      createdCount: 1,
      updatedCount: 1,
    });
  });

  it("calls modelProfiles.ensureAll only with profiles not already registered", async () => {
    const { service, ensureAllCalls } = makeService({ characters: [], profiles: [PROFILE] });
    const csv = buildCsv([
      csvRow({ handle: "usesexisting", modelProfileId: PROFILE.id }),
      csvRow({
        handle: "usesnew",
        modelProfileId: "new-profile",
        providerId: "anthropic",
        model: "claude-x",
      }),
    ]);

    await service.importCsv(csv);

    expect(ensureAllCalls).toHaveLength(1);
    expect(ensureAllCalls[0]).toEqual([
      { id: "new-profile", providerId: "anthropic", model: "claude-x" },
    ]);
  });

  it("wraps an importMany failure in CharacterCsvError with the cause attached", async () => {
    const cause = new Error("constraint violation");
    const { service } = makeService({
      characters: [],
      profiles: [PROFILE],
      importMany: () => Promise.reject(cause),
    });
    const csv = buildCsv([csvRow({ handle: "newhandle" })]);

    const error = await service.importCsv(csv).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(CharacterCsvError);
    expect((error as CharacterCsvError).cause).toBe(cause);
  });
});

describe("CharacterService.exportCsv", () => {
  it("names the file with today's date and includes soft-deleted rows with their post counts", async () => {
    const active = makeCharacter("char-active", "active1");
    const deleted = {
      ...makeCharacter("char-deleted", "deleted1"),
      deletedAt: new Date("2026-01-01T00:00:00Z"),
    };
    const { service } = makeService({
      characters: [active, deleted],
      profiles: [PROFILE],
      postCounts: new Map([
        ["char-active", 3],
        ["char-deleted", 5],
      ]),
    });

    const result = await service.exportCsv();

    expect(result.filename).toMatch(/^brickr-characters-\d{4}-\d{2}-\d{2}\.csv$/u);
    const rows = parseCharactersCsv(result.csv);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "char-active", postCount: "3", isDeleted: false }),
        expect.objectContaining({ id: "char-deleted", postCount: "5", isDeleted: true }),
      ]),
    );
  });
});
