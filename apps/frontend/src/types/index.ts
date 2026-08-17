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
 * What the composer dialog is posting to (Brickr-ux-refine §17.1).
 *
 * `roomId` is the actual write destination and is always present, even
 * for `reply`/`quote` where it duplicates `post.roomId` — the point is
 * that a reply or quote always targets the post's own room, never wherever
 * the reader happened to be looking (the unified feed, in particular, has no
 * room of its own to reply into).
 *
 * `quote` is also the repost mechanism — there is no separate repost field.
 */
export type ComposerContext =
  | { mode: "new"; roomId: string; roomLabel: string }
  | { mode: "reply"; roomId: string; post: PostDto }
  | { mode: "quote"; roomId: string; post: PostDto };
