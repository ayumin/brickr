/**
 * UI-only types.
 *
 * Anything that crosses the network boundary lives in `@enjo/shared`.
 * Nothing here may describe prompts, providers, models or credentials —
 * the frontend never sees those (CLAUDE.md §8, §47).
 */
import type { PostDto } from "@enjo/shared";

/** A character the backend told us is currently generating ("考え中"). */
export type ThinkingCharacter = {
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
export type ConnectionState = "connecting" | "open" | "reconnecting";

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
 * A view switch, not a route: no React Router in this app.
 */
export type TimelineView =
  | { kind: "home" }
  | { kind: "timeline"; authorId: string };
