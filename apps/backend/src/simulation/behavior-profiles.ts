/**
 * BehaviorProfile — code-defined archetypes that govern how a Cast character
 * participates autonomously in a Room (design spec §11).
 *
 * Each profile bundles the timing and concurrency parameters that the
 * ScheduledEvent worker uses when deciding whether and when a character should
 * respond, revive a thread, or join a room.  Individual overrides and a
 * management UI are intentionally out of scope (§11: "個別 override は作らない").
 *
 * Adding or tuning a profile is a code change; the UI only lets a Cast creator
 * pick from the existing keys.
 */

import type { Rng } from "./responder-selector.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The six initial archetypes.  The union is the authoritative list of valid
 * `behaviorProfileKey` values on a Character.
 */
export type BehaviorProfileKey =
  | "eager"
  | "casual"
  | "thoughtful"
  | "lurker"
  | "night_owl"
  | "morning_person";

/**
 * Parameters that control autonomous Cast behaviour.
 *
 * All delay / cooldown values are in **milliseconds** so they can be compared
 * directly against `Date.now()` and stored as-is in `ScheduledEvent.scheduledAt`.
 */
export type BehaviorProfile = {
  /** Human-readable label (for logs and future UI). */
  readonly label: string;

  /**
   * Base probability [0, 1] that this character responds to a new post in a
   * room it belongs to.  Multiplied by the post's relevance score before the
   * final coin-flip.
   */
  readonly responseWeight: number;

  /**
   * Base probability [0, 1] that this character revives a thread that has gone
   * quiet (used by the `thread.revive` event type).
   */
  readonly revivalWeight: number;

  /** Minimum delay before the character's response is scheduled (ms). */
  readonly minDelay: number;

  /** Maximum delay before the character's response is scheduled (ms). */
  readonly maxDelay: number;

  /**
   * Minimum gap between two consecutive responses from this character in the
   * same room (ms).  A new `character.respond` event is not created while an
   * earlier one is still within its cooldown window.
   */
  readonly cooldown: number;

  /**
   * Maximum number of pending `character.respond` events this character may
   * have across all rooms at once.  Prevents a very active character from
   * flooding the queue.
   */
  readonly maxConcurrent: number;
};

// ---------------------------------------------------------------------------
// Profile definitions
// ---------------------------------------------------------------------------

/**
 * The six initial BehaviorProfiles.
 *
 * Design notes (§11):
 *   - At least one profile must allow immediate / rapid responses.
 *   - `maxAutoResponders` is intentionally absent; concurrency is controlled
 *     per-character via `maxConcurrent` instead.
 *   - Time-of-day logic for `night_owl` / `morning_person` is applied at
 *     scheduling time (when `scheduledAt` is computed), not here.
 */
export const BEHAVIOR_PROFILES: Readonly<Record<BehaviorProfileKey, BehaviorProfile>> = {
  /**
   * Jumps in quickly and often.  Allows rapid back-and-forth and simultaneous
   * reservations in multiple rooms.
   */
  eager: {
    label: "Eager",
    responseWeight: 0.85,
    revivalWeight: 0.4,
    minDelay: 3_000, // 3 s
    maxDelay: 20_000, // 20 s
    cooldown: 45_000, // 45 s
    maxConcurrent: 4,
  },

  /**
   * Participates regularly but without urgency.  A balanced default for most
   * characters.
   */
  casual: {
    label: "Casual",
    responseWeight: 0.55,
    revivalWeight: 0.2,
    minDelay: 15_000, // 15 s
    maxDelay: 90_000, // 90 s
    cooldown: 120_000, // 2 min
    maxConcurrent: 2,
  },

  /**
   * Takes time to compose a considered reply.  Lower frequency, longer delays,
   * but still engages meaningfully.
   */
  thoughtful: {
    label: "Thoughtful",
    responseWeight: 0.45,
    revivalWeight: 0.15,
    minDelay: 60_000, // 1 min
    maxDelay: 300_000, // 5 min
    cooldown: 600_000, // 10 min
    maxConcurrent: 1,
  },

  /**
   * Mostly watches.  Rarely responds, almost never revives threads.  When it
   * does speak, the delay is long and unpredictable.
   */
  lurker: {
    label: "Lurker",
    responseWeight: 0.15,
    revivalWeight: 0.05,
    minDelay: 120_000, // 2 min
    maxDelay: 600_000, // 10 min
    cooldown: 1_800_000, // 30 min
    maxConcurrent: 1,
  },

  /**
   * Most active in the late evening / night hours.  The worker applies a
   * time-of-day multiplier that boosts `responseWeight` between 21:00–02:00
   * and suppresses it during the day.
   */
  night_owl: {
    label: "Night Owl",
    responseWeight: 0.6,
    revivalWeight: 0.25,
    minDelay: 10_000, // 10 s
    maxDelay: 60_000, // 1 min
    cooldown: 90_000, // 90 s
    maxConcurrent: 3,
  },

  /**
   * Most active in the early morning hours.  The worker applies a time-of-day
   * multiplier that boosts `responseWeight` between 05:00–09:00 and suppresses
   * it at night.
   */
  morning_person: {
    label: "Morning Person",
    responseWeight: 0.6,
    revivalWeight: 0.25,
    minDelay: 10_000, // 10 s
    maxDelay: 60_000, // 1 min
    cooldown: 90_000, // 90 s
    maxConcurrent: 3,
  },
} as const;

// ---------------------------------------------------------------------------
// Action selection helpers
// ---------------------------------------------------------------------------

/**
 * Decides whether a character with the given profile should respond to a post,
 * given a relevance score and an injectable Rng.
 *
 * `relevanceScore` is a [0, 1] value computed by the caller (e.g. from topic /
 * interest overlap).  It scales the profile's `responseWeight` so that a
 * highly relevant post raises the chance and an off-topic one lowers it.
 *
 * The final probability is clamped to [0, 1] before the coin-flip.
 */
export function shouldCastRespond(
  profile: BehaviorProfile,
  options: {
    relevanceScore: number;
    rng: Rng;
  },
): boolean {
  const { relevanceScore, rng } = options;
  const probability = Math.min(profile.responseWeight * (0.5 + relevanceScore * 0.5), 1);
  return rng() < probability;
}

/**
 * Computes the delay (ms) before a character's response is scheduled.
 *
 * The delay is sampled uniformly from [minDelay, maxDelay] using the provided
 * Rng, making it deterministic in tests when a seeded Rng is injected.
 */
export function calculateDelay(profile: BehaviorProfile, rng: Rng): number {
  return profile.minDelay + rng() * (profile.maxDelay - profile.minDelay);
}

/**
 * Decides whether a character with the given profile should attempt to revive
 * a quiet thread.
 *
 * Uses the profile's `revivalWeight` directly as the probability; no relevance
 * scaling is applied because revival is opportunistic rather than topic-driven.
 */
export function shouldReviveThread(profile: BehaviorProfile, rng: Rng): boolean {
  return rng() < profile.revivalWeight;
}

/**
 * Returns the BehaviorProfile for the given key, or the `casual` default when
 * the key is absent (e.g. for characters created before profiles were introduced).
 */
export function resolveProfile(key: BehaviorProfileKey | null | undefined): BehaviorProfile {
  if (key && key in BEHAVIOR_PROFILES) {
    return BEHAVIOR_PROFILES[key];
  }
  return BEHAVIOR_PROFILES.casual;
}
