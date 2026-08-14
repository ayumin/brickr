/**
 * Capability-to-action mapping for the unified feed thread card (§9.3, §16.3).
 *
 * Pure function over `FeedCapabilitiesDto` — no React, no side effects.
 * The client must never infer what a reader may do from a `status` field or
 * from whether a session exists: the server decides per-thread and encodes
 * the answer in `capabilities`.
 *
 * Testable independently of any component.
 */
import type { FeedCapabilitiesDto } from "@brickr/shared";

/**
 * What the root post in a feed thread card may offer to the reader.
 *
 * Each field maps directly to a prop on `PostCard` (or the room label):
 * `true` means the affordance is available and the caller should wire up the
 * corresponding handler; `false` means it must be omitted entirely — not
 * disabled, not hidden behind a CSS class, but absent from the DOM so that
 * screen readers and keyboard navigation never encounter it (§27 a11y rule).
 */
export type FeedRootActions = {
  /** Avatar / display-name / handle clicks open the author's timeline. */
  canOpenAuthor: boolean;
  /** Room label is a navigable link rather than plain text. */
  canOpenRoom: boolean;
  /** Expand icon opens the post detail view. */
  canOpenThread: boolean;
  /** Reply action button is rendered. */
  canReply: boolean;
  /** Repost / quote action button is rendered. */
  canQuote: boolean;
};

/**
 * What each previewed reply in a feed thread card may offer.
 *
 * Replies never carry their own reply/quote actions in the preview — those
 * live on the full thread detail page. The only interactive affordances here
 * are navigation ones.
 */
export type FeedReplyActions = {
  /** Avatar / display-name / handle clicks open the author's timeline. */
  canOpenAuthor: boolean;
  /** Expand icon opens the post detail view. */
  canOpenThread: boolean;
};

/**
 * The full set of actions derived from one thread's capabilities.
 *
 * `showMoreReplies` is separate from `FeedReplyActions` because it belongs to
 * the thread as a whole, not to any individual reply post.
 */
export type FeedThreadActions = {
  root: FeedRootActions;
  replies: FeedReplyActions;
  /** "残りN件を表示" button is rendered when true and there are hidden replies. */
  showMoreReplies: boolean;
};

/**
 * Derive the full set of UI actions for a feed thread card from its
 * `capabilities` object.
 *
 * Rules (§9.3, §16.3, §27):
 * - Anonymous readers receive `NOTHING` capabilities from the server, so every
 *   action is false and no interactive element is emitted.
 * - A stopped room's thread arrives with `canReply`, `canQuote`, and
 *   `canOpenRoom` all false; the card renders the room name as plain text and
 *   hides the write actions.
 * - `canOpenThread` and `canLoadMoreReplies` stay true for the room's creator
 *   and administrator even when the room is stopped.
 * - The mapping is 1-to-1: no field here is inferred from another capability
 *   or from any external state.
 */
export function selectFeedThreadActions(
  capabilities: FeedCapabilitiesDto,
): FeedThreadActions {
  return {
    root: {
      canOpenAuthor: capabilities.canOpenAuthor,
      canOpenRoom: capabilities.canOpenRoom,
      canOpenThread: capabilities.canOpenThread,
      canReply: capabilities.canReply,
      canQuote: capabilities.canQuote,
    },
    replies: {
      canOpenAuthor: capabilities.canOpenAuthor,
      canOpenThread: capabilities.canOpenThread,
    },
    showMoreReplies: capabilities.canLoadMoreReplies,
  };
}
