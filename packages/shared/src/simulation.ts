import type { PostDto } from "./post.js";

export const SIMULATION_STATUSES = ["active", "archived"] as const;

export type SimulationStatus = (typeof SIMULATION_STATUSES)[number];

/**
 * Internal only: `scope` never reaches a screen as a label (§8.1). The reserved
 * global simulation is shown as "フィード", ordinary ones as rooms.
 */
export const SIMULATION_SCOPES = ["global", "room"] as const;

export type SimulationScope = (typeof SIMULATION_SCOPES)[number];

/**
 * The one simulation the unified feed posts into (§8.2).
 *
 * A real row with a fixed id, rather than `simulationId = null`, so the existing
 * foreign key, posting API and permission checks keep working unchanged. It is
 * seeded, never created through the API, and rejects rename/stop/resume/delete.
 */
export const GLOBAL_SIMULATION_ID = "00000000-0000-4000-8000-000000000001";

/** Title seeded for the global simulation, and what the feed is called on screen. */
export const GLOBAL_SIMULATION_TITLE = "フィード";

export type SimulationDto = {
  id: string;
  title: string | null;
  status: SimulationStatus;
  createdAt: string;
  /** Public to everyone, unlike Character ownership (§66.6). Absent for pre-login simulations. */
  createdByUserId?: string;
};

/**
 * Who created a room, as the room list shows it (§10.3).
 *
 * Room ownership is public, unlike a character's (§66.6), so this travels with
 * every entry. It is a public account shape rather than a raw id because an id
 * says nothing to a reader — and `null` means the room has no owner at all.
 */
export type SimulationCreatorDto = {
  id: string;
  handle: string;
  displayName: string;
};

export type SimulationSummaryDto = SimulationDto & {
  postCount: number;
  /** Newest activity anywhere in the room. The room list orders by it (§10.3). */
  lastActivityAt: string;
  creator: SimulationCreatorDto | null;
  /**
   * Rename/stop/resume/analysis, decided by the server (§10.3).
   *
   * The client must not re-derive this from `createdByUserId` and the session:
   * duplicating the rule in the frontend is how the two drift apart, and the
   * server is the only side that can enforce it anyway.
   */
  canManage: boolean;
};

export type SimulationsResponse = {
  simulations: SimulationSummaryDto[];
};

export type CreateSimulationRequest = {
  title?: string;
};

export type CreateSimulationResponse = {
  simulation: SimulationDto;
};

export type UpdateSimulationRequest = {
  title: string;
};

export type SimulationPostRankingDto = {
  postId: string;
  content: string;
  author: PostDto["author"];
  replyCount: number;
  repostCount: number;
  score: number;
  createdAt: string;
};

export type SimulationAuthorRankingDto = {
  author: PostDto["author"];
  postCount: number;
  replyCount: number;
  repostCount: number;
  receivedReactionCount: number;
};

export type SimulationContentSummaryDto = {
  overallTopics: string;
  postOverview: string;
  highEngagementTopics: string;
  lowEngagementTopics: string;
};

export type SimulationAnalysisDto = {
  simulation: SimulationDto;
  summary: SimulationContentSummaryDto;
  postCount: number;
  authorCount: number;
  replyCount: number;
  repostCount: number;
  ranking: SimulationPostRankingDto[];
  authorRanking: SimulationAuthorRankingDto[];
};

export type SimulationAnalysisResponse = {
  analysis: SimulationAnalysisDto;
};

/**
 * One room's basics, without its posts (§10.4).
 *
 * The posts used to ride along here, which meant opening a room downloaded its
 * entire history. Reading a room is the feed's job now
 * (`GET /api/simulations/:id/feed`), which pages instead.
 *
 * Summary-shaped (postCount/creator/canManage), same as the list endpoint's
 * entries: the room info panel (§19.2) needs exactly these fields for one
 * room, and duplicating the room list's summary type for a single-room
 * variant would just be the same fields under a different name.
 */
export type SimulationResponse = {
  simulation: SimulationSummaryDto;
};
