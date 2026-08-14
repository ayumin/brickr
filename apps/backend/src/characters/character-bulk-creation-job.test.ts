import type { CharacterDto } from "@brickr/shared";
import { describe, expect, it, vi } from "vitest";
import { CharacterBulkCreationJobs } from "./character-bulk-creation-job.js";
import { CharacterGenerationError } from "./character-generator.js";

function fakeCharacterDto(id: string): CharacterDto {
  return { id, handle: id, displayName: id, description: "" };
}

describe("CharacterBulkCreationJobs", () => {
  it("reaches completed with the created count", async () => {
    const jobs = new CharacterBulkCreationJobs((count) =>
      Promise.resolve(Array.from({ length: count }, (_, index) => fakeCharacterDto(`c${String(index)}`))),
    );

    const started = jobs.start(2, "user-1");

    expect(started).toMatchObject({ status: "generating", completed: 0, total: 2 });
    await vi.waitFor(() => {
      expect(jobs.find(started.id)).toMatchObject({
        status: "completed",
        completed: 2,
        createdCount: 2,
      });
    });
  });

  it("carries the underlying generation reason on a failed job", async () => {
    const jobs = new CharacterBulkCreationJobs(() =>
      Promise.reject(new CharacterGenerationError({ cause: new Error("invalid structured output") })),
    );

    const started = jobs.start(2, "user-1");

    await vi.waitFor(() => {
      expect(jobs.find(started.id)).toMatchObject({
        status: "failed",
        error: "キャラクター生成処理でエラーが発生しました: invalid structured output",
      });
    });
  });

  it("transitions from generating to saving once progress reaches the total", () => {
    let reportProgress: ((completed: number) => void) | undefined;
    // Never resolves: the test only inspects the two in-flight states, both
    // reachable synchronously since the Promise executor runs immediately.
    const jobs = new CharacterBulkCreationJobs(
      (_count, _userId, onProgress) =>
        new Promise(() => {
          reportProgress = onProgress;
        }),
    );

    const started = jobs.start(3, "user-1");
    reportProgress?.(1);
    expect(jobs.find(started.id)).toMatchObject({ status: "generating", completed: 1 });

    reportProgress?.(3);
    expect(jobs.find(started.id)).toMatchObject({ status: "saving", completed: 3 });
  });

  it("preserves the last reported progress when the run then fails", async () => {
    const jobs = new CharacterBulkCreationJobs(
      (_count, _userId, onProgress) =>
        new Promise((_resolve, reject) => {
          onProgress(1);
          reject(new Error("failed after partial progress"));
        }),
    );

    const started = jobs.start(3, "user-1");

    await vi.waitFor(() => {
      expect(jobs.find(started.id)).toMatchObject({ status: "failed", completed: 1 });
    });
  });

  it("evicts the oldest job once more than 100 are tracked", () => {
    const jobs = new CharacterBulkCreationJobs(() => new Promise(() => undefined));

    const first = jobs.start(1, "user-1");
    for (let index = 0; index < 100; index += 1) {
      jobs.start(1, "user-1");
    }

    expect(jobs.find(first.id)).toBeNull();
  });

  it("returns null for an unknown job id", () => {
    const jobs = new CharacterBulkCreationJobs(() => Promise.resolve([]));
    expect(jobs.find("unknown-id")).toBeNull();
  });
});
