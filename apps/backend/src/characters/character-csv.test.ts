import { describe, expect, it } from "vitest";
import type { Character } from "./character.js";
import { CharacterCsvError, exportCharactersCsv, parseCharactersCsv } from "./character-csv.js";

const CHARACTER: Character = {
  id: "character-1",
  handle: "csv_test",
  displayName: "CSV, Test",
  description: "first line\nsecond line",
  rolePrompt: "role, with comma",
  tonePrompt: "tone",
  dialectPrompt: "",
  interests: ["CSV", "管理"],
  activityLevel: 0.1,
  responseProbability: 0.2,
  replyProbability: 0.3,
  quoteProbability: 0.4,
  influence: 0.5,
  modelProfileId: "openai-default",
};

describe("character CSV", () => {
  it("round-trips quoted text and exports postCount", () => {
    const csv = exportCharactersCsv(
      [CHARACTER],
      new Map([
        ["openai-default", { id: "openai-default", providerId: "openai", model: "gpt-test" }],
      ]),
      new Map([[CHARACTER.id, 42]]),
    );
    expect(csv).toContain("投稿数");
    expect(csv).toContain("停止");
    expect(csv).toContain("行動プロファイル");
    expect(csv).toContain("自律参加");
    const [row] = parseCharactersCsv(csv);
    expect(row).toMatchObject({
      id: CHARACTER.id,
      displayName: CHARACTER.displayName,
      description: CHARACTER.description,
      interests: CHARACTER.interests,
      postCount: "42",
      isDeleted: false,
      behaviorProfileKey: null,
      castAutonomous: true,
    });
  });

  it("accepts a non-numeric postCount because import deliberately ignores it", () => {
    const csv = exportCharactersCsv(
      [CHARACTER],
      new Map([
        ["openai-default", { id: "openai-default", providerId: "openai", model: "gpt-test" }],
      ]),
      new Map([[CHARACTER.id, 1]]),
    ).replace(/,1,FALSE$/u, ",ignored,FALSE");
    expect(parseCharactersCsv(csv)[0]?.postCount).toBe("ignored");
  });

  it("exports and imports the logical deletion flag", () => {
    const stopped = { ...CHARACTER, deletedAt: new Date("2026-01-01T00:00:00Z") };
    const csv = exportCharactersCsv(
      [stopped],
      new Map([
        ["openai-default", { id: "openai-default", providerId: "openai", model: "gpt-test" }],
      ]),
      new Map(),
    );

    expect(parseCharactersCsv(csv)[0]?.isDeleted).toBe(true);
  });

  it("rejects missing columns and duplicate handles", () => {
    expect(() => parseCharactersCsv("id,handle\n1,test")).toThrow(CharacterCsvError);
    const csv = exportCharactersCsv(
      [CHARACTER, { ...CHARACTER, id: "character-2" }],
      new Map([
        ["openai-default", { id: "openai-default", providerId: "openai", model: "gpt-test" }],
      ]),
      new Map(),
    );
    expect(() => parseCharactersCsv(csv)).toThrow(/重複/u);
  });

  // CSV import is a second path into character creation, independent of
  // saveCharacterSchema — the 3-character minimum and reserved-word list
  // (CLAUDE.md §66.2) must hold here too, or they are not real limits.
  it("rejects a handle shorter than the 3-character minimum", () => {
    const csv = exportCharactersCsv(
      [CHARACTER],
      new Map([
        ["openai-default", { id: "openai-default", providerId: "openai", model: "gpt-test" }],
      ]),
      new Map(),
    ).replace(/csv_test/u, "ab");
    expect(() => parseCharactersCsv(csv)).toThrow(CharacterCsvError);
  });

  it("rejects a reserved handle", () => {
    const csv = exportCharactersCsv(
      [CHARACTER],
      new Map([
        ["openai-default", { id: "openai-default", providerId: "openai", model: "gpt-test" }],
      ]),
      new Map(),
    ).replace(/csv_test/u, "login");
    expect(() => parseCharactersCsv(csv)).toThrow(CharacterCsvError);
  });
});
