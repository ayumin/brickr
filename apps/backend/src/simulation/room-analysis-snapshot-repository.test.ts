import { describe, expect, it, vi } from "vitest";
import type { Db } from "../persistence/prisma.js";
import { RoomAnalysisSnapshotRepository } from "./room-analysis-snapshot-repository.js";

const row = {
  id: "snapshot-1",
  roomId: "room-1",
  postCount: 3,
  latestPostId: "post-3",
  summary: "previous summary",
  status: "failed",
  error: "LLM timeout",
  createdAt: new Date("2026-08-16T00:00:00Z"),
  updatedAt: new Date("2026-08-17T00:00:00Z"),
};

function makeRepository() {
  const upsert = vi.fn(() => Promise.resolve(row));
  const db = { roomAnalysisSnapshot: { upsert } } as unknown as Db;
  return { repository: new RoomAnalysisSnapshotRepository(db), upsert };
}

describe("RoomAnalysisSnapshotRepository.upsert", () => {
  it("preserves successful analysis fields when a later attempt fails", async () => {
    const { repository, upsert } = makeRepository();

    await repository.upsert({
      roomId: "room-1",
      postCount: 4,
      latestPostId: "post-4",
      summary: null,
      status: "failed",
      error: "LLM timeout",
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          status: "failed",
          error: "LLM timeout",
        },
      }),
    );
  });

  it("replaces analysis fields after a successful attempt", async () => {
    const { repository, upsert } = makeRepository();

    await repository.upsert({
      roomId: "room-1",
      postCount: 4,
      latestPostId: "post-4",
      summary: "new summary",
      status: "completed",
      error: null,
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          postCount: 4,
          latestPostId: "post-4",
          summary: "new summary",
          status: "completed",
          error: null,
        },
      }),
    );
  });
});
