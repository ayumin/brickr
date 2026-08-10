import type { PostDto } from "./post.js";

export const SIMULATION_STATUSES = ["active", "stopped"] as const;

export type SimulationStatus = (typeof SIMULATION_STATUSES)[number];

export type SimulationDto = {
  id: string;
  title: string | null;
  status: SimulationStatus;
  createdAt: string;
};

export type CreateSimulationRequest = {
  title?: string;
};

export type CreateSimulationResponse = {
  simulation: SimulationDto;
};

export type SimulationResponse = {
  simulation: SimulationDto;
  posts: PostDto[];
};
