/**
 * Thread revival service (issue #165).
 *
 * Handles the `thread.revive` scheduled event type.
 *
 * A "dormant" thread is a root post whose `threadActivityAt` has not been
 * updated for at least `DORMANT_THRESHOLD_MS`. The worker schedules
 * `thread.revive` events periodically (via `room.review`), and this service
 * picks a dormant thread, selects a character whose behavior profile says it
 * should revive threads, and generates a new post to restart the conversation.
 *
 * Design notes:
 *   - Clock and Rng are injected so tests are deterministic.
 *   - A character is only chosen if `shouldReviveThread` returns true for its
 *     profile, so the revival rate is governed by the same profile parameters
 *     as response timing.
 *   - The character posts a standalone `post` action (not a reply) so the
 *     revival appears as a fresh top-level contribution to the thread rather
 *     than a direct reply to the root.
 *   - If no dormant thread or no willing character is found, the function
 *     returns a `skipped` outcome — this is not an error.
 */

import type { CharacterRepository } from "../characters/character-repository.js";
import type { AgentService } from "../agents/agent-service.js";
import type { PostService } from "../posts/post-service.js";
import type { ThreadService } from "../posts/thread-service.js";
import type { SimulationRepository } from "./simulation-repository.js";
import type { RoomMembershipRepository } from "./room-membership-repository.js";
import type { Rng } from "./responder-selector.js";
import { resolveProfile, shouldReviveThread } from "./behavior-profiles.js";
import { selectAction, resolveActionTargets } from "./action-selector.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * A thread is considered dormant when its last activity is older than this
 * threshold. 2 hours is long enough to avoid reviving threads that are still
 * naturally active, but short enough to keep rooms feeling alive.
 */
export const DORMANT_THRESHOLD_MS = 2 * 60 * 60 * 1_000; // 2 hours

/**
 * Maximum number of dormant thread candidates to consider. We pick the most
 * recently active one so the revival feels natural rather than digging up
 * ancient history.
 */
const CANDIDATE_LIMIT = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Clock = () => Date;

export type ThreadRevivalDeps = {
  simulations: SimulationRepository;
  characters: CharacterRepository;
  memberships: RoomMembershipRepository;
  posts: PostService;
  threads: ThreadService;
  agents: AgentService;
  /** Injectable clock for deterministic tests. Defaults to `() => new Date()`. */
  clock?: Clock;
  /** Injectable Rng for deterministic tests. Defaults to `Math.random`. */
  rng?: Rng;
};

export type ThreadRevivalResult =
  | { outcome: "revived"; characterId: string; postId: string }
  | { outcome: "skipped"; reason: string }
  | { outcome: "error"; reason: string };

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Attempts to revive a dormant thread in the given room.
 *
 * Called by the `thread.revive` event handler. Selects the most recently
 * active dormant thread, picks a willing character, and generates a post.
 *
 * Returns one result describing what happened.
 */
export async function reviveThread(
  roomId: string,
  deps: ThreadRevivalDeps,
): Promise<ThreadRevivalResult> {
  const clock = deps.clock ?? (() => new Date());
  const rng = deps.rng ?? Math.random;

  // Verify the room is still active.
  const room = await deps.simulations.findById(roomId);
  if (!room || room.status === "archived") {
    return { outcome: "skipped", reason: "room not found or archived" };
  }

  // Find dormant thread candidates: root posts whose threadActivityAt is old.
  const dormantBefore = new Date(clock().getTime() - DORMANT_THRESHOLD_MS);
  const dormantRoots = await deps.posts.findDormantThreadRoots(roomId, dormantBefore, CANDIDATE_LIMIT);

  if (dormantRoots.length === 0) {
    return { outcome: "skipped", reason: "no dormant threads found" };
  }

  // Pick the most recently active dormant thread (first in the list, since
  // findDormantThreadRoots returns them ordered by threadActivityAt DESC).
  const targetPost = dormantRoots[0]!;

  // Load active Cast members for this room.
  const activeCastIds = await deps.memberships.findActiveCastIds(roomId);
  if (activeCastIds.length === 0) {
    return { outcome: "skipped", reason: "no active Cast members in room" };
  }

  // Load all characters and filter to active Cast members.
  const allCharacters = await deps.characters.findAll();
  const activeCast = allCharacters.filter((c) => activeCastIds.includes(c.id));

  // Shuffle the cast so we don't always pick the same character.
  const shuffled = shuffleArray(activeCast, rng);

  // Find the first character whose profile says it should revive threads.
  const reviver = shuffled.find((character) => {
    const profile = resolveProfile(
      character.behaviorProfileKey as Parameters<typeof resolveProfile>[0],
    );
    return shouldReviveThread(profile, rng);
  });

  if (!reviver) {
    return { outcome: "skipped", reason: "no character willing to revive thread" };
  }

  // Load the thread context for the target post.
  const thread = await deps.threads.getCurrentThread(targetPost.id);
  if (!thread) {
    return { outcome: "skipped", reason: "thread context unavailable" };
  }

  // Build the handle resolver.
  const users = await deps.posts.findUsersByIds(
    [thread.target, ...thread.posts].map((p) => p.authorId),
  );
  const byId = new Map<string, string>([
    ...allCharacters.map((c) => [c.id, c.handle] as const),
    ...users.map((u) => [u.id, u.handle] as const),
  ]);
  const resolveHandle = (authorId: string): string => byId.get(authorId) ?? authorId;

  // Select an action and generate the revival post.
  try {
    const action = selectAction({
      character: reviver,
      target: thread.target,
      threadPosts: thread.posts,
      rng,
    });

    const generated = await deps.agents.generate({
      character: reviver,
      target: thread.target,
      posts: thread.posts,
      action,
      resolveHandle,
    });

    const { replyTo, quoteOf } = resolveActionTargets(action, thread.target);

    const post = await deps.posts.publish({
      roomId,
      authorId: reviver.id,
      content: generated.content,
      replyTo,
      quoteOf,
    });

    return { outcome: "revived", characterId: reviver.id, postId: post.id };
  } catch (error) {
    return {
      outcome: "error",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fisher-Yates shuffle using the injected Rng. */
function shuffleArray<T>(array: T[], rng: Rng): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = result[i]!;
    result[i] = result[j]!;
    result[j] = temp;
  }
  return result;
}
