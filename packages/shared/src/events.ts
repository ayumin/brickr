import type { PostDto } from "./post.js";

/**
 * SSE event names sent on GET /api/simulations/:id/events
 */
export const SSE_EVENT_TYPES = [
  "post.created",
  "character.processing",
  "character.skipped",
  "character.failed",
  "simulation.completed",
  "simulation.failed",
] as const;

export type SseEventType = (typeof SSE_EVENT_TYPES)[number];

/** A post finished generating and was persisted. */
export type PostCreatedEvent = {
  type: "post.created";
  simulationId: string;
  post: PostDto;
};

/** A character started working. Used only to render a "考え中" indicator. */
export type CharacterProcessingEvent = {
  type: "character.processing";
  simulationId: string;
  characterId: string;
  handle: string;
  displayName: string;
};

/** A character decided not to respond, so the UI can drop its indicator. */
export type CharacterSkippedEvent = {
  type: "character.skipped";
  simulationId: string;
  characterId: string;
};

/** An expected failure: one provider errored or timed out. Others continue. */
export type CharacterFailedEvent = {
  type: "character.failed";
  simulationId: string;
  characterId: string;
  reason: string;
};

/** Every responder for one user post has finished (or failed). */
export type SimulationCompletedEvent = {
  type: "simulation.completed";
  simulationId: string;
  /** The user post that triggered this round of responses. */
  triggerPostId: string;
  generatedPostIds: string[];
};

/** The whole run could not proceed. */
export type SimulationFailedEvent = {
  type: "simulation.failed";
  simulationId: string;
  reason: string;
};

export type SseEvent =
  | PostCreatedEvent
  | CharacterProcessingEvent
  | CharacterSkippedEvent
  | CharacterFailedEvent
  | SimulationCompletedEvent
  | SimulationFailedEvent;
