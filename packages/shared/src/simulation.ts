import type { PostDto } from "./post.js";

export const SIMULATION_STATUSES = ["active", "stopped"] as const;

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

export type SimulationSummaryDto = SimulationDto & {
  postCount: number;
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

export type SimulationResponse = {
  simulation: SimulationDto;
  posts: PostDto[];
};
