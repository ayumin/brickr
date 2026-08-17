/**
 * The one thing worth remembering across a sign-in (§18.2): a compose the
 * visitor was in the middle of when they were asked to authenticate.
 *
 * Deliberately just this one variant (not a general "return to X" bag) —
 * phase 1 has exactly one flow that needs resuming after auth. Kept as plain
 * SPA state (`AuthIntentContext`), not storage: nothing here is sensitive,
 * and it only ever needs to survive a `/login`↔`/` navigation within the same
 * tab, not a reload (§18.2 explicitly allows storage but recommends state).
 */
import { roomPath } from "../../routes";
import type { ComposerContext } from "../../types";

export type AuthIntent = { type: "compose"; context: ComposerContext } | null;

/**
 * Where to land after a successful sign-in that has a pending compose intent,
 * so the composer reopens over the right backdrop instead of an unrelated
 * screen (§17.1: a reply/quote's destination is the post's own room, not the
 * feed, even though the intent itself carries that context along either way).
 */
export function composerContextLandingPath(context: ComposerContext): string {
  return roomPath(context.roomId);
}
