import type { CharacterBulkCreationJobDto, CharacterDto } from "@brickr/shared";
import { randomUUID } from "node:crypto";
import { CharacterGenerationError, CharacterPersonaParseError } from "./character-generator.js";
import { LLMError, LLMTimeoutError } from "../llm/provider.js";

const MAXIMUM_JOBS = 100;

/**
 * Tracks the progress of an async, LLM-driven bulk character creation run
 * (CLAUDE.md §50) so the client can poll it, independent of the request that
 * started it.
 */
export class CharacterBulkCreationJobs {
  private readonly jobs = new Map<string, CharacterBulkCreationJobDto>();

  constructor(
    private readonly createMany: (
      count: number,
      createdByUserId: string,
      onProgress: (completed: number) => void,
    ) => Promise<CharacterDto[]>,
  ) {}

  start(count: number, createdByUserId: string): CharacterBulkCreationJobDto {
    const id = randomUUID();
    const job: CharacterBulkCreationJobDto = {
      id,
      status: "generating",
      completed: 0,
      total: count,
      createdCount: 0,
    };
    this.jobs.set(id, job);
    this.prune();

    void this.createMany(count, createdByUserId, (completed) => {
      this.jobs.set(id, {
        ...job,
        status: completed >= count ? "saving" : "generating",
        completed,
      });
    })
      .then((created) => {
        this.jobs.set(id, {
          ...job,
          status: "completed",
          completed: count,
          createdCount: created.length,
        });
      })
      .catch((error: unknown) => {
        const current = this.jobs.get(id) ?? job;
        this.jobs.set(id, {
          ...current,
          status: "failed",
          error: characterGenerationFailureMessage(error),
        });
      });

    return job;
  }

  find(id: string): CharacterBulkCreationJobDto | null {
    return this.jobs.get(id) ?? null;
  }

  private prune(): void {
    while (this.jobs.size > MAXIMUM_JOBS) {
      const oldestId = this.jobs.keys().next().value as string | undefined;
      if (!oldestId) return;
      this.jobs.delete(oldestId);
    }
  }
}

function characterGenerationFailureMessage(error: unknown): string {
  const cause = error instanceof CharacterGenerationError ? error.cause : error;
  if (cause instanceof LLMTimeoutError) {
    return `LLMの応答がタイムアウトしました: ${safeErrorDetail(cause.message)}`;
  }
  if (cause instanceof LLMError) {
    return `LLM APIの呼び出しに失敗しました: ${safeErrorDetail(cause.message)}`;
  }
  if (cause instanceof CharacterPersonaParseError) return cause.message;
  if (cause instanceof Error) {
    return `キャスト生成処理でエラーが発生しました: ${safeErrorDetail(cause.message)}`;
  }
  return "LLMによるキャスト生成に失敗しました。";
}

function safeErrorDetail(message: string): string {
  const normalized = message.replace(/\s+/gu, " ").trim();
  return Array.from(normalized).slice(0, 240).join("");
}
