/**
 * UI-only types.
 *
 * Anything that crosses the network boundary lives in `@brickr/shared`.
 * Nothing here may describe prompts, providers, models or credentials —
 * the frontend never sees those (CLAUDE.md §8, §47).
 */
import type { PostDto } from "@brickr/shared";

/** A character the backend told us is currently generating ("考え中"). */
export type ThinkingCharacter = {
  targetPostId: string;
  characterId: string;
  handle: string;
  displayName: string;
};

/** An expected, non-fatal failure of a single character's LLM call. */
export type CharacterFailure = {
  characterId: string;
  /** Best-known label: display name if we saw a `character.processing` first. */
  label: string;
  reason: string;
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
