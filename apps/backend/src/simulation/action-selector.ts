import type { Character } from "../characters/character.js";
import type { Post } from "../posts/post.js";
import type { Rng } from "./responder-selector.js";
import type { ResponseAction } from "./simulation.js";

const defaultRng: Rng = Math.random;

export type ActionSelectionInput = {
  character: Character;
  target: Post;
  /** Posts already in the thread, used to decide whether a quote makes sense. */
  threadPosts: Post[];
  rng?: Rng;
};

/**
 * Chooses how a character responds: `reply`, `quote`, or a standalone `post`.
 *
 * Weights come from the character's own `replyProbability` / `quoteProbability`,
 * which is what makes some characters reply-heavy and others quote-heavy.
 */
export function selectAction(input: ActionSelectionInput): ResponseAction {
  const rng = input.rng ?? defaultRng;
  const { character } = input;

  // Quoting a reply that is already deep in a thread reads badly, so only quote
  // top-level posts.
  const quotable = input.target.replyTo === null;

  const replyWeight = Math.max(character.replyProbability, 0.05);
  const quoteWeight = quotable ? Math.max(character.quoteProbability, 0) : 0;
  // Whatever probability mass is left over becomes a standalone comment.
  const postWeight = Math.max(1 - replyWeight - quoteWeight, 0.05);

  const total = replyWeight + quoteWeight + postWeight;
  let threshold = rng() * total;

  threshold -= replyWeight;
  if (threshold <= 0) return "reply";

  threshold -= quoteWeight;
  if (threshold <= 0) return "quote";

  return "post";
}

/**
 * Resolves the action into the `replyTo` / `quoteOf` fields of the new post.
 */
export function resolveActionTargets(
  action: ResponseAction,
  target: Post,
): { replyTo: string | null; quoteOf: string | null } {
  switch (action) {
    case "reply":
      return { replyTo: target.id, quoteOf: null };
    case "quote":
      return { replyTo: null, quoteOf: target.id };
    case "post":
      return { replyTo: null, quoteOf: null };
  }
}
