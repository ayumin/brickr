/**
 * UI-only types.
 *
 * Anything that crosses the network boundary lives in `@brickr/shared`.
 * Nothing here may describe prompts, providers, models or credentials —
 * the frontend never sees those (CLAUDE.md §8, §47).
 */
import type { PostDto } from "@brickr/shared";

/**
 * One response the backend is generating right now.
 *
 * Anonymous by design (§11.2): the stream says that a response is on its way and
 * what it answers, never who is writing it. `activityId` means nothing beyond
 * matching a finish to its start, so the UI can only ever count activities.
 */
export type ResponseActivity = {
  activityId: string;
  targetPostId: string;
};

/** EventSource lifecycle, mapped to something we can show a human. */
export type ConnectionState = "connecting" | "open" | "reconnecting" | "disconnected";

/** Generic async phase used by the bootstrap screens. */
export type LoadPhase = "loading" | "ready" | "error";

/**
 * What an inline composer is scoped to.
 * `quote` is also the repost mechanism — there is no separate repost field.
 */
export type ComposerScope = {
  mode: "reply" | "quote";
  post: PostDto;
};

/**
 * Which screen the single page is showing.
 * Kept in sync with the URL by `routes.ts` / `SimulationView`, not owned by a
 * `<Route>` tree — see the comment at the top of `routes.ts` for why.
 */
export type TimelineView =
  | { kind: "home" }
  | { kind: "characters" }
  | { kind: "simulations" }
  | { kind: "simulation-analysis"; simulationId: string }
  | { kind: "post"; postId: string }
  | { kind: "users-management" }
  | { kind: "timeline"; authorId: string };
