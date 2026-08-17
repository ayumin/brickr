/**
 * Tests for the Room Analysis Panel logic (issue #170).
 *
 * Covers the four scenarios from the acceptance criteria:
 *   - owner: can see the update button and trigger updates
 *   - member: sees the snapshot read-only (no update button)
 *   - no-change: snapshot is returned with updated: false
 *   - failed: failed snapshot shows last successful result when available
 *
 * These tests exercise the pure helper functions that drive the UI state,
 * keeping them independent of React and the DOM.
 */
import { describe, expect, it } from "vitest";
import type { RoomAnalysisSnapshotDto } from "@brickr/shared";
import {
  canUpdateRoomAnalysis as canUpdate,
  parseSummary,
} from "./RoomAnalysisPanel";
import { toRoomAnalysisUpdateResult } from "./useRoomAnalysisSnapshot";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const completedSummaryJson = JSON.stringify({
  overallTopics: "AIの議論",
  postOverview: "活発な議論が行われました",
  highEngagementTopics: "倫理問題",
  lowEngagementTopics: "技術的詳細",
});

function makeSnapshot(
  overrides: Partial<RoomAnalysisSnapshotDto> = {},
): RoomAnalysisSnapshotDto {
  return {
    id: "snap-1",
    roomId: "room-1",
    postCount: 10,
    latestPostId: "post-10",
    summary: completedSummaryJson,
    status: "completed",
    error: null,
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseSummary tests
// ---------------------------------------------------------------------------

describe("parseSummary", () => {
  it("parses a valid JSON summary string", () => {
    const result = parseSummary(completedSummaryJson);
    expect(result).toEqual({
      overallTopics: "AIの議論",
      postOverview: "活発な議論が行われました",
      highEngagementTopics: "倫理問題",
      lowEngagementTopics: "技術的詳細",
    });
  });

  it("returns null for null input", () => {
    expect(parseSummary(null)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseSummary("not json")).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    expect(parseSummary(JSON.stringify({ overallTopics: "only one field" }))).toBeNull();
  });

  it.each([null, 42, { nested: true }, ["unexpected"]])(
    "returns null when a required value is not a string: %j",
    (invalidValue) => {
      expect(parseSummary(JSON.stringify({
        overallTopics: invalidValue,
        postOverview: "overview",
        highEngagementTopics: "high",
        lowEngagementTopics: "low",
      }))).toBeNull();
    },
  );

  it("returns null for an empty string", () => {
    expect(parseSummary("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// canUpdate tests — owner scenario
// ---------------------------------------------------------------------------

describe("canUpdate — owner", () => {
  it("allows update when owner, active room, not updating, snapshot ready and completed", () => {
    expect(
      canUpdate({
        isOwner: true,
        isArchived: false,
        updating: false,
        state: { status: "ready", snapshot: makeSnapshot() },
      }),
    ).toBe(true);
  });

  it("allows update when owner and no snapshot exists yet", () => {
    expect(
      canUpdate({
        isOwner: true,
        isArchived: false,
        updating: false,
        state: { status: "none" },
      }),
    ).toBe(true);
  });

  it("allows update when owner and snapshot failed", () => {
    expect(
      canUpdate({
        isOwner: true,
        isArchived: false,
        updating: false,
        state: { status: "ready", snapshot: makeSnapshot({ status: "failed", error: "LLM error" }) },
      }),
    ).toBe(true);
  });

  it("disables update while an update is in flight", () => {
    expect(
      canUpdate({
        isOwner: true,
        isArchived: false,
        updating: true,
        state: { status: "ready", snapshot: makeSnapshot() },
      }),
    ).toBe(false);
  });

  it("disables update while snapshot is pending", () => {
    expect(
      canUpdate({
        isOwner: true,
        isArchived: false,
        updating: false,
        state: { status: "ready", snapshot: makeSnapshot({ status: "pending" }) },
      }),
    ).toBe(false);
  });

  it("disables update while state is loading", () => {
    expect(
      canUpdate({
        isOwner: true,
        isArchived: false,
        updating: false,
        state: { status: "loading" },
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canUpdate tests — member scenario
// ---------------------------------------------------------------------------

describe("canUpdate — member (non-owner)", () => {
  it("never allows update for a non-owner", () => {
    expect(
      canUpdate({
        isOwner: false,
        isArchived: false,
        updating: false,
        state: { status: "ready", snapshot: makeSnapshot() },
      }),
    ).toBe(false);
  });

  it("never allows update for a non-owner even when no snapshot exists", () => {
    expect(
      canUpdate({
        isOwner: false,
        isArchived: false,
        updating: false,
        state: { status: "none" },
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canUpdate tests — archived room
// ---------------------------------------------------------------------------

describe("canUpdate — archived room", () => {
  it("disables update for an archived room even for the owner", () => {
    expect(
      canUpdate({
        isOwner: true,
        isArchived: true,
        updating: false,
        state: { status: "ready", snapshot: makeSnapshot() },
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// no-change scenario — snapshot returned with updated: false
// ---------------------------------------------------------------------------

describe("no-change scenario", () => {
  it("surfaces unchanged while keeping the returned snapshot ready", () => {
    const snapshot = makeSnapshot();
    const result = toRoomAnalysisUpdateResult({ snapshot, updated: false });

    expect(result).toEqual({
      state: { status: "ready", snapshot },
      outcome: "unchanged",
    });

    expect(
      canUpdate({
        isOwner: true,
        isArchived: false,
        updating: false,
        state: result.state,
      }),
    ).toBe(true);
  });

  it("surfaces regenerated snapshots as updated", () => {
    const snapshot = makeSnapshot();
    expect(toRoomAnalysisUpdateResult({ snapshot, updated: true })).toEqual({
      state: { status: "ready", snapshot },
      outcome: "updated",
    });
  });
});

// ---------------------------------------------------------------------------
// failed snapshot scenario
// ---------------------------------------------------------------------------

describe("failed snapshot", () => {
  it("lastSuccessful summary is parseable when present", () => {
    const lastSuccessful = makeSnapshot({ id: "snap-0", status: "completed" });
    const failedSnapshot = makeSnapshot({
      status: "failed",
      error: "LLM timeout",
      summary: completedSummaryJson, // retained from last success
      lastSuccessful,
    });

    // The failed snapshot's lastSuccessful should have a parseable summary.
    expect(parseSummary(failedSnapshot.lastSuccessful?.summary ?? null)).not.toBeNull();
  });

  it("handles failed snapshot with no prior successful result", () => {
    const failedSnapshot = makeSnapshot({
      status: "failed",
      error: "LLM timeout",
      summary: null,
      lastSuccessful: undefined,
    });

    expect(failedSnapshot.lastSuccessful).toBeUndefined();
    expect(parseSummary(failedSnapshot.summary)).toBeNull();
  });

  it("owner can still trigger update after a failure", () => {
    const failedSnapshot = makeSnapshot({ status: "failed", error: "LLM error" });
    expect(
      canUpdate({
        isOwner: true,
        isArchived: false,
        updating: false,
        state: { status: "ready", snapshot: failedSnapshot },
      }),
    ).toBe(true);
  });
});
