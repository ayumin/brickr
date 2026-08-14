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

/**
 * What an inline composer is scoped to.
 * `quote` is also the repost mechanism — there is no separate repost field.
 */
export type ComposerScope = {
  mode: "reply" | "quote";
  post: PostDto;
};
