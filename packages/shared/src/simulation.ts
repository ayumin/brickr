import type { PostDto } from "./post.js";

export const SIMULATION_STATUSES = ["active", "stopped"] as const;

export type SimulationStatus = (typeof SIMULATION_STATUSES)[number];

export type SimulationDto = {
  id: string;
  title: string | null;
  status: SimulationStatus;
  createdAt: string;
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
