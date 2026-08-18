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
 *   - The character replies to the dormant thread root so publishing the
 *     revival advances that thread's `threadActivityAt`.
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
import type { CastParticipationResolver } from "./cast-participation-resolver.js";

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
  /** Resolves which Cast characters are eligible to respond in a given room (issue #177). */
  castResolver: CastParticipationResolver;
  /** Injectable clock for deterministic tests. Defaults to `() => new Date()`. */
  clock?: Clock;
  /** Injectable Rng for deterministic tests. Defaults to `Math.random`. */
  rng?: Rng;
  /** Specific dormant root selected by `room.review`, when scheduled from one. */
  targetPostId?: string;
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

  const dormantBefore = new Date(clock().getTime() - DORMANT_THRESHOLD_MS);
  let targetPost;
  if (deps.targetPostId) {
    const scheduledTarget = await deps.posts.findById(deps.targetPostId);
    if (
      !scheduledTarget ||
      scheduledTarget.roomId !== roomId ||
      scheduledTarget.replyTo !== null ||
      scheduledTarget.threadActivityAt > dormantBefore
    ) {
      return { outcome: "skipped", reason: "scheduled target is not a dormant thread root" };
    }
    targetPost = scheduledTarget;
  } else {
    // Unscoped/manual events choose the most recently active dormant root.
    const dormantRoots = await deps.posts.findDormantThreadRoots(
      roomId,
      dormantBefore,
      CANDIDATE_LIMIT,
    );
    if (dormantRoots.length === 0) {
      return { outcome: "skipped", reason: "no dormant threads found" };
    }
    targetPost = dormantRoots[0]!;
  }

  // Resolve the eligible Cast for this room: all active Casts for the Feed
  // room, or only active-membership Casts for a regular room (issue #177).
  const activeCast = await deps.castResolver.resolveRespondingCasts({
    roomId,
    roomScope: room.scope,
  });
  if (activeCast.length === 0) {
    return { outcome: "skipped", reason: "no active Cast members in room" };
  }

  // Load all characters for handle resolution (includes non-Cast authors).
  const allCharacters = await deps.characters.findAll();

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

  // A revival must be a reply: only replies advance the root thread's activity.
  try {
    const action = "reply" as const;

    const generated = await deps.agents.generate({
      character: reviver,
      target: thread.target,
      posts: thread.posts,
      action,
      resolveHandle,
    });

    const post = await deps.posts.publish({
      roomId,
      authorId: reviver.id,
      content: generated.content,
      replyTo: thread.target.id,
      quoteOf: null,
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
