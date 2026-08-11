import { isReservedHandle } from "@brickr/shared";
import { z } from "zod";
import type { Character } from "./character.js";
import type { ModelProfile } from "../model-profiles/model-profile.js";

const CHARACTER_CSV_COLUMNS = [
  { key: "id", label: "ID" },
  { key: "handle", label: "ハンドル" },
  { key: "displayName", label: "表示名" },
  { key: "description", label: "プロフィール" },
  { key: "avatarUrl", label: "アバター" },
  { key: "rolePrompt", label: "Persona" },
  { key: "tonePrompt", label: "口調" },
  { key: "dialectPrompt", label: "方言" },
  { key: "interests", label: "興味" },
  { key: "activityLevel", label: "活動" },
  { key: "responseProbability", label: "反応" },
  { key: "replyProbability", label: "返信" },
  { key: "quoteProbability", label: "引用" },
  { key: "influence", label: "影響" },
  { key: "modelProfileId", label: "モデルプロファイルID" },
  { key: "providerId", label: "プロバイダー" },
  { key: "model", label: "モデル" },
  { key: "postCount", label: "投稿数" },
  { key: "isDeleted", label: "停止" },
] as const;

export const CHARACTER_CSV_HEADERS = CHARACTER_CSV_COLUMNS.map(({ label }) => label);

const importedRowSchema = z.object({
  id: z.string().trim().max(64),
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{3,32}$/u)
    .refine((value) => !isReservedHandle(value), "handle is reserved"),
  displayName: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  avatarUrl: z.string().max(1_500_000).refine(
    (value) =>
      value === "" ||
      /^https?:\/\/[^\s]+$/u.test(value) ||
      /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(value),
    "avatarUrl must be an HTTP(S) URL or supported image data URL",
  ),
  rolePrompt: z.string().trim().min(1).max(4_000),
  tonePrompt: z.string().trim().min(1).max(4_000),
  dialectPrompt: z.string().trim().max(2_000),
  interests: z.string().transform((value, context) => {
    try {
      const parsed = JSON.parse(value) as unknown;
      return z.array(z.string().trim().min(1).max(80)).max(20).parse(parsed);
    } catch {
      context.addIssue({ code: "custom", message: "interests must be a JSON string array" });
      return z.NEVER;
    }
  }),
  activityLevel: probability(),
  responseProbability: probability(),
  replyProbability: probability(),
  quoteProbability: probability(),
  influence: probability(),
  modelProfileId: z.string().trim().min(1).max(64),
  providerId: z.enum(["openai", "anthropic", "gemini", "mock"]),
  model: z.string().trim().min(1).max(200),
  // Deliberately accepted as arbitrary text and discarded during import.
  postCount: z.string(),
  isDeleted: z.string().transform((raw, context) => {
    const value = raw.trim().toLowerCase();
    if (["true", "1", "yes", "停止"].includes(value)) return true;
    if (["false", "0", "no", "", "アクティブ"].includes(value)) return false;
    context.addIssue({ code: "custom", message: "停止はTRUEまたはFALSEで指定してください" });
    return z.NEVER;
  }),
});

export type ImportedCharacterCsvRow = z.infer<typeof importedRowSchema>;

export function exportCharactersCsv(
  characters: Character[],
  models: Map<string, ModelProfile>,
  postCounts: Map<string, number>,
): string {
  const rows = characters.map((character) => {
    const profile = models.get(character.modelProfileId);
    return [
      character.id,
      character.handle,
      character.displayName,
      character.description,
      character.avatarUrl ?? "",
      character.rolePrompt,
      character.tonePrompt,
      character.dialectPrompt ?? "",
      JSON.stringify(character.interests),
      character.activityLevel,
      character.responseProbability,
      character.replyProbability,
      character.quoteProbability,
      character.influence,
      character.modelProfileId,
      profile?.providerId ?? "",
      profile?.model ?? "",
      postCounts.get(character.id) ?? 0,
      Boolean(character.deletedAt).toString().toUpperCase(),
    ].map((value) => csvCell(String(value))).join(",");
  });
  return [`\uFEFF${CHARACTER_CSV_HEADERS.join(",")}`, ...rows].join("\r\n");
}

export function parseCharactersCsv(csv: string): ImportedCharacterCsvRow[] {
  const records = parseCsvRecords(csv.replace(/^\uFEFF/u, ""));
  if (records.length < 2) throw new CharacterCsvError("CSVにデータ行がありません。");
  const header = records[0] ?? [];
  for (const { key, label } of CHARACTER_CSV_COLUMNS) {
    // The deletion flag was added later; old exports import as active characters.
    if (key !== "isDeleted" && !header.includes(label) && !header.includes(key)) {
      throw new CharacterCsvError(`CSV列「${label}」がありません。`);
    }
  }
  const seenHandles = new Set<string>();
  return records.slice(1).filter((record) => record.some((cell) => cell.trim())).map((record, index) => {
    const raw = Object.fromEntries(
      CHARACTER_CSV_COLUMNS.map(({ key, label }) => {
        const column = header.indexOf(label) >= 0 ? header.indexOf(label) : header.indexOf(key);
        return [key, column >= 0 ? record[column] ?? "" : ""];
      }),
    );
    const result = importedRowSchema.safeParse(raw);
    if (!result.success) {
      throw new CharacterCsvError(`CSV ${String(index + 2)}行目が不正です: ${result.error.issues[0]?.message ?? "invalid row"}`);
    }
    if (seenHandles.has(result.data.handle)) {
      throw new CharacterCsvError(`CSV内で@${result.data.handle}が重複しています。`);
    }
    seenHandles.add(result.data.handle);
    return result.data;
  });
}

function probability() {
  return z.string().transform((raw, context) => {
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      context.addIssue({ code: "custom", message: "behaviour values must be from 0 to 1" });
      return z.NEVER;
    }
    return value;
  });
}

function csvCell(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function parseCsvRecords(source: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"' && cell.length === 0) quoted = true;
    else if (character === ",") { row.push(cell); cell = ""; }
    else if (character === "\n") { row.push(cell.replace(/\r$/u, "")); records.push(row); row = []; cell = ""; }
    else cell += character;
  }
  if (quoted) throw new CharacterCsvError("CSVの引用符が閉じられていません。");
  if (cell.length > 0 || row.length > 0) { row.push(cell.replace(/\r$/u, "")); records.push(row); }
  return records;
}

export class CharacterCsvError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CharacterCsvError";
  }
}
