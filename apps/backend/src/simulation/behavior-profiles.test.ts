import { describe, expect, it } from "vitest";
import type { Rng } from "./responder-selector.js";
import {
  BEHAVIOR_PROFILES,
  type BehaviorProfileKey,
  calculateDelay,
  resolveProfile,
  shouldCastRespond,
  shouldReviveThread,
} from "./behavior-profiles.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic Rng: hands out queued values in order, then clamps to the last
 * value so a test never depends on how many times rng is called.
 */
function makeRng(values: readonly number[]): Rng {
  let index = 0;
  return () => {
    const value = values.length === 0 ? 0 : (values[Math.min(index, values.length - 1)] ?? 0);
    index += 1;
    return value;
  };
}

/** Seeded linear-congruential generator — deterministic but not trivially constant. */
class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed;
  }

  random(): number {
    // LCG parameters from Numerical Recipes
    this.state = (this.state * 1_664_525 + 1_013_904_223) >>> 0;
    return this.state / 0x1_0000_0000;
  }
}

/** rng draws spanning 0 up to just under 1. */
const RNG_SWEEP: readonly number[] = Array.from({ length: 100 }, (_unused, step) => step / 100);

// ---------------------------------------------------------------------------
// BEHAVIOR_PROFILES shape
// ---------------------------------------------------------------------------

describe("BEHAVIOR_PROFILES", () => {
  const keys: BehaviorProfileKey[] = [
    "eager",
    "casual",
    "thoughtful",
    "lurker",
    "night_owl",
    "morning_person",
  ];

  it("defines exactly the six expected profiles", () => {
    expect(Object.keys(BEHAVIOR_PROFILES).sort()).toEqual([...keys].sort());
  });

  it.each(keys)("%s has all required fields with valid ranges", (key) => {
    const profile = BEHAVIOR_PROFILES[key];

    expect(profile.label).toBeTypeOf("string");
    expect(profile.label.length).toBeGreaterThan(0);

    expect(profile.responseWeight).toBeGreaterThanOrEqual(0);
    expect(profile.responseWeight).toBeLessThanOrEqual(1);

    expect(profile.revivalWeight).toBeGreaterThanOrEqual(0);
    expect(profile.revivalWeight).toBeLessThanOrEqual(1);

    expect(profile.minDelay).toBeGreaterThan(0);
    expect(profile.maxDelay).toBeGreaterThanOrEqual(profile.minDelay);

    expect(profile.cooldown).toBeGreaterThan(0);
    expect(profile.maxConcurrent).toBeGreaterThanOrEqual(1);
  });

  it("eager has the highest responseWeight of all profiles", () => {
    const weights = Object.values(BEHAVIOR_PROFILES).map((p) => p.responseWeight);
    expect(BEHAVIOR_PROFILES.eager.responseWeight).toBe(Math.max(...weights));
  });

  it("lurker has the lowest responseWeight of all profiles", () => {
    const weights = Object.values(BEHAVIOR_PROFILES).map((p) => p.responseWeight);
    expect(BEHAVIOR_PROFILES.lurker.responseWeight).toBe(Math.min(...weights));
  });

  it("eager has a shorter maxDelay than thoughtful", () => {
    expect(BEHAVIOR_PROFILES.eager.maxDelay).toBeLessThan(BEHAVIOR_PROFILES.thoughtful.maxDelay);
  });

  it("thoughtful has a longer cooldown than casual", () => {
    expect(BEHAVIOR_PROFILES.thoughtful.cooldown).toBeGreaterThan(
      BEHAVIOR_PROFILES.casual.cooldown,
    );
  });

  it("night_owl and morning_person share the same timing parameters", () => {
    const { label: _labelNight, ...nightRest } = BEHAVIOR_PROFILES.night_owl;
    const { label: _labelMorning, ...morningRest } = BEHAVIOR_PROFILES.morning_person;
    expect(nightRest).toEqual(morningRest);
  });
});

// ---------------------------------------------------------------------------
// shouldCastRespond
// ---------------------------------------------------------------------------

describe("shouldCastRespond", () => {
  it("always returns false when rng() >= effective probability", () => {
    const profile = BEHAVIOR_PROFILES.eager; // responseWeight = 0.85
    // relevanceScore = 0 → probability = 0.85 * 0.5 = 0.425
    // rng() = 0.5 > 0.425 → false
    expect(
      shouldCastRespond(profile, { relevanceScore: 0, rng: makeRng([0.5]) }),
    ).toBe(false);
  });

  it("always returns true when rng() < effective probability", () => {
    const profile = BEHAVIOR_PROFILES.eager; // responseWeight = 0.85
    // relevanceScore = 1 → probability = min(0.85 * 1.0, 1) = 0.85
    // rng() = 0.1 < 0.85 → true
    expect(
      shouldCastRespond(profile, { relevanceScore: 1, rng: makeRng([0.1]) }),
    ).toBe(true);
  });

  it("a lurker almost never responds even at full relevance", () => {
    const profile = BEHAVIOR_PROFILES.lurker; // responseWeight = 0.15
    // probability = min(0.15 * 1.0, 1) = 0.15
    let trueCount = 0;
    for (const rngValue of RNG_SWEEP) {
      if (shouldCastRespond(profile, { relevanceScore: 1, rng: makeRng([rngValue]) })) {
        trueCount += 1;
      }
    }
    // Only rng draws < 0.15 should return true → at most 15 out of 100
    expect(trueCount).toBeLessThanOrEqual(15);
  });

  it("an eager character responds most of the time at full relevance", () => {
    const profile = BEHAVIOR_PROFILES.eager; // responseWeight = 0.85
    // probability = min(0.85 * 1.0, 1) = 0.85
    let trueCount = 0;
    for (const rngValue of RNG_SWEEP) {
      if (shouldCastRespond(profile, { relevanceScore: 1, rng: makeRng([rngValue]) })) {
        trueCount += 1;
      }
    }
    expect(trueCount).toBeGreaterThanOrEqual(80);
  });

  it("higher relevance raises the response rate", () => {
    const profile = BEHAVIOR_PROFILES.casual;

    const countFor = (relevanceScore: number): number => {
      let count = 0;
      for (const rngValue of RNG_SWEEP) {
        if (shouldCastRespond(profile, { relevanceScore, rng: makeRng([rngValue]) })) {
          count += 1;
        }
      }
      return count;
    };

    expect(countFor(1)).toBeGreaterThan(countFor(0));
  });

  it("probability is clamped to 1 even when responseWeight * scale > 1", () => {
    // Construct a synthetic profile with responseWeight = 1.0
    const profile = { ...BEHAVIOR_PROFILES.eager, responseWeight: 1.0 };
    // relevanceScore = 1 → probability = min(1.0 * 1.0, 1) = 1.0
    // Every rng draw < 1 should return true
    for (const rngValue of RNG_SWEEP) {
      expect(
        shouldCastRespond(profile, { relevanceScore: 1, rng: makeRng([rngValue]) }),
      ).toBe(true);
    }
  });

  it("is deterministic: same seed always produces the same sequence", () => {
    const profile = BEHAVIOR_PROFILES.casual;
    const rng1 = new SeededRng(42);
    const rng2 = new SeededRng(42);

    const results1 = Array.from({ length: 20 }, () =>
      shouldCastRespond(profile, { relevanceScore: 0.5, rng: () => rng1.random() }),
    );
    const results2 = Array.from({ length: 20 }, () =>
      shouldCastRespond(profile, { relevanceScore: 0.5, rng: () => rng2.random() }),
    );

    expect(results1).toEqual(results2);
  });
});

// ---------------------------------------------------------------------------
// calculateDelay
// ---------------------------------------------------------------------------

describe("calculateDelay", () => {
  it("returns minDelay when rng() = 0", () => {
    const profile = BEHAVIOR_PROFILES.casual;
    expect(calculateDelay(profile, makeRng([0]))).toBe(profile.minDelay);
  });

  it("returns maxDelay when rng() = 1", () => {
    const profile = BEHAVIOR_PROFILES.casual;
    expect(calculateDelay(profile, makeRng([1]))).toBe(profile.maxDelay);
  });

  it("always stays within [minDelay, maxDelay] for all rng draws", () => {
    for (const key of Object.keys(BEHAVIOR_PROFILES) as BehaviorProfileKey[]) {
      const profile = BEHAVIOR_PROFILES[key];
      for (const rngValue of RNG_SWEEP) {
        const delay = calculateDelay(profile, makeRng([rngValue]));
        expect(delay).toBeGreaterThanOrEqual(profile.minDelay);
        expect(delay).toBeLessThanOrEqual(profile.maxDelay);
      }
    }
  });

  it("is deterministic: same seed always produces the same delay", () => {
    const profile = BEHAVIOR_PROFILES.eager;
    const rng1 = new SeededRng(99);
    const rng2 = new SeededRng(99);

    const delays1 = Array.from({ length: 10 }, () => calculateDelay(profile, () => rng1.random()));
    const delays2 = Array.from({ length: 10 }, () => calculateDelay(profile, () => rng2.random()));

    expect(delays1).toEqual(delays2);
  });

  it("eager has shorter delays than thoughtful on average", () => {
    const avgDelay = (key: BehaviorProfileKey): number => {
      const profile = BEHAVIOR_PROFILES[key];
      const total = RNG_SWEEP.reduce(
        (sum, rngValue) => sum + calculateDelay(profile, makeRng([rngValue])),
        0,
      );
      return total / RNG_SWEEP.length;
    };

    expect(avgDelay("eager")).toBeLessThan(avgDelay("thoughtful"));
  });
});

// ---------------------------------------------------------------------------
// shouldReviveThread
// ---------------------------------------------------------------------------

describe("shouldReviveThread", () => {
  it("returns false when rng() >= revivalWeight", () => {
    const profile = BEHAVIOR_PROFILES.casual; // revivalWeight = 0.2
    expect(shouldReviveThread(profile, makeRng([0.2]))).toBe(false);
    expect(shouldReviveThread(profile, makeRng([0.5]))).toBe(false);
  });

  it("returns true when rng() < revivalWeight", () => {
    const profile = BEHAVIOR_PROFILES.casual; // revivalWeight = 0.2
    expect(shouldReviveThread(profile, makeRng([0.1]))).toBe(true);
    expect(shouldReviveThread(profile, makeRng([0.19]))).toBe(true);
  });

  it("a lurker almost never revives threads", () => {
    const profile = BEHAVIOR_PROFILES.lurker; // revivalWeight = 0.05
    let trueCount = 0;
    for (const rngValue of RNG_SWEEP) {
      if (shouldReviveThread(profile, makeRng([rngValue]))) trueCount += 1;
    }
    expect(trueCount).toBeLessThanOrEqual(5);
  });

  it("an eager character revives threads more often than a lurker", () => {
    const countFor = (key: BehaviorProfileKey): number => {
      const profile = BEHAVIOR_PROFILES[key];
      return RNG_SWEEP.filter((rngValue) => shouldReviveThread(profile, makeRng([rngValue])))
        .length;
    };

    expect(countFor("eager")).toBeGreaterThan(countFor("lurker"));
  });
});

// ---------------------------------------------------------------------------
// resolveProfile
// ---------------------------------------------------------------------------

describe("resolveProfile", () => {
  it("returns the matching profile for a valid key", () => {
    expect(resolveProfile("eager")).toBe(BEHAVIOR_PROFILES.eager);
    expect(resolveProfile("thoughtful")).toBe(BEHAVIOR_PROFILES.thoughtful);
    expect(resolveProfile("lurker")).toBe(BEHAVIOR_PROFILES.lurker);
  });

  it("falls back to casual when the key is null", () => {
    expect(resolveProfile(null)).toBe(BEHAVIOR_PROFILES.casual);
  });

  it("falls back to casual when the key is undefined", () => {
    expect(resolveProfile(undefined)).toBe(BEHAVIOR_PROFILES.casual);
  });

  it("falls back to casual for an unknown key string", () => {
    // Cast to satisfy TypeScript — simulates a DB value from before profiles existed.
    expect(resolveProfile("unknown_profile" as BehaviorProfileKey)).toBe(
      BEHAVIOR_PROFILES.casual,
    );
  });

  it("returns all six profiles without falling back", () => {
    const keys: BehaviorProfileKey[] = [
      "eager",
      "casual",
      "thoughtful",
      "lurker",
      "night_owl",
      "morning_person",
    ];
    for (const key of keys) {
      expect(resolveProfile(key)).toBe(BEHAVIOR_PROFILES[key]);
    }
  });
});
