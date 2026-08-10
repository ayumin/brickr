import { describe, expect, it } from "vitest";
import type { Character } from "../characters/character.js";
import type { Rng } from "./responder-selector.js";
import { selectResponders, shouldRespond } from "./responder-selector.js";

/**
 * Deterministic rng: hands out the queued values in order, then clamps to the
 * last value forever so a test never depends on how many times rng is called.
 */
function makeRng(values: readonly number[]): Rng {
  let index = 0;
  return () => {
    const value = values.length === 0 ? 0 : (values[Math.min(index, values.length - 1)] ?? 0);
    index += 1;
    return value;
  };
}

function makeCharacter(overrides: Partial<Character> & { id: string }): Character {
  return {
    handle: overrides.id.replace(/^c-/u, ""),
    displayName: overrides.id,
    description: "",
    rolePrompt: "role",
    tonePrompt: "tone",
    interests: [],
    activityLevel: 0.5,
    responseProbability: 0.5,
    replyProbability: 0.5,
    quoteProbability: 0.2,
    influence: 0.5,
    modelProfileId: "openai-default",
    ...overrides,
  };
}

const architect = makeCharacter({ id: "c-architect", handle: "architect" });
const skeptic = makeCharacter({ id: "c-skeptic", handle: "skeptic" });
const kansai = makeCharacter({ id: "c-kansai", handle: "kansai" });
const engineer = makeCharacter({ id: "c-engineer", handle: "engineer" });
const lawyer = makeCharacter({ id: "c-lawyer", handle: "lawyer" });
const beginner = makeCharacter({ id: "c-beginner", handle: "beginner" });

const cast = [architect, skeptic, kansai, engineer, lawyer, beginner];

function ids(characters: Character[]): string[] {
  return characters.map((character) => character.id);
}

describe("selectResponders", () => {
  describe("mandatory responders", () => {
    it("always puts mentioned handles into mandatory", () => {
      const selection = selectResponders({
        characters: cast,
        mentionedHandles: ["skeptic", "kansai"],
        explicitIds: [],
        minResponders: 0,
        maxResponders: 2,
        rng: makeRng([0]),
      });

      expect(ids(selection.mandatory)).toEqual(["c-skeptic", "c-kansai"]);
      expect(selection.additional).toEqual([]);
    });

    it("resolves mentioned handles case-insensitively", () => {
      const selection = selectResponders({
        characters: cast,
        mentionedHandles: ["SKEPTIC"],
        explicitIds: [],
        minResponders: 0,
        maxResponders: 1,
        rng: makeRng([0]),
      });

      expect(ids(selection.mandatory)).toEqual(["c-skeptic"]);
    });

    it("turns explicitly selected ids into mandatory responders", () => {
      const selection = selectResponders({
        characters: cast,
        mentionedHandles: [],
        explicitIds: ["c-lawyer", "c-engineer"],
        minResponders: 0,
        maxResponders: 2,
        rng: makeRng([0]),
      });

      expect(ids(selection.mandatory)).toEqual(["c-lawyer", "c-engineer"]);
    });

    it("orders mentions ahead of explicit selections", () => {
      const selection = selectResponders({
        characters: cast,
        mentionedHandles: ["kansai"],
        explicitIds: ["c-architect"],
        minResponders: 0,
        maxResponders: 2,
        rng: makeRng([0]),
      });

      expect(ids(selection.mandatory)).toEqual(["c-kansai", "c-architect"]);
    });

    it("does not duplicate a character that is both mentioned and explicitly selected", () => {
      const selection = selectResponders({
        characters: cast,
        mentionedHandles: ["skeptic"],
        explicitIds: ["c-skeptic", "c-architect"],
        minResponders: 0,
        maxResponders: 2,
        rng: makeRng([0]),
      });

      expect(ids(selection.mandatory)).toEqual(["c-skeptic", "c-architect"]);
    });

    it("ignores unknown handles and unknown ids silently", () => {
      const selection = selectResponders({
        characters: cast,
        mentionedHandles: ["ghostwriter", "nobody"],
        explicitIds: ["c-does-not-exist"],
        minResponders: 0,
        maxResponders: 0,
        rng: makeRng([0]),
      });

      expect(selection.mandatory).toEqual([]);
      expect(selection.all).toEqual([]);
    });
  });

  describe("exclusions", () => {
    it("never selects an excluded character even when it is mentioned", () => {
      const selection = selectResponders({
        characters: cast,
        mentionedHandles: ["skeptic"],
        explicitIds: [],
        excludeIds: ["c-skeptic"],
        minResponders: 0,
        maxResponders: 0,
        rng: makeRng([0]),
      });

      expect(selection.all).toEqual([]);
    });

    it("never selects an excluded character even when it is explicitly picked", () => {
      const selection = selectResponders({
        characters: cast,
        mentionedHandles: [],
        explicitIds: ["c-skeptic"],
        excludeIds: ["c-skeptic"],
        minResponders: 0,
        maxResponders: 0,
        rng: makeRng([0]),
      });

      expect(selection.all).toEqual([]);
    });

    it("never draws an excluded author into the random sample", () => {
      // The post's own author is excluded; asking for everyone must still skip it.
      const selection = selectResponders({
        characters: cast,
        mentionedHandles: [],
        explicitIds: [],
        excludeIds: ["c-architect"],
        minResponders: cast.length,
        maxResponders: cast.length,
        rng: makeRng([0, 0.5]),
      });

      expect(ids(selection.all)).not.toContain("c-architect");
      expect(selection.all).toHaveLength(cast.length - 1);
    });
  });

  describe("result shape", () => {
    it("returns all as mandatory followed by additional with no duplicates", () => {
      const selection = selectResponders({
        characters: cast,
        mentionedHandles: ["skeptic"],
        explicitIds: [],
        minResponders: 3,
        maxResponders: 3,
        rng: makeRng([0, 0.5, 0.5]),
      });

      expect(ids(selection.all)).toEqual([
        ...ids(selection.mandatory),
        ...ids(selection.additional),
      ]);
      expect(new Set(ids(selection.all)).size).toBe(selection.all.length);
      expect(selection.all).toHaveLength(3);
    });

    it("respects maxResponders when there are no mandatory responders", () => {
      for (const rngValue of [0, 0.25, 0.5, 0.75, 0.999]) {
        const selection = selectResponders({
          characters: cast,
          mentionedHandles: [],
          explicitIds: [],
          minResponders: 2,
          maxResponders: 4,
          rng: makeRng([rngValue, 0.5]),
        });

        expect(selection.all.length).toBeGreaterThanOrEqual(2);
        expect(selection.all.length).toBeLessThanOrEqual(4);
      }
    });

    it("reaches maxResponders when the rng asks for the top of the range", () => {
      const selection = selectResponders({
        characters: cast,
        mentionedHandles: [],
        explicitIds: [],
        minResponders: 2,
        maxResponders: 4,
        rng: makeRng([0.999, 0.5]),
      });

      expect(selection.all).toHaveLength(4);
    });

    it("counts mandatory responders against the target so a fully mentioned cast does not overshoot", () => {
      const trio = [architect, skeptic, kansai];
      const selection = selectResponders({
        characters: trio,
        mentionedHandles: ["architect", "skeptic", "kansai"],
        explicitIds: [],
        minResponders: 1,
        maxResponders: 3,
        rng: makeRng([0, 0.5]),
      });

      expect(selection.mandatory).toHaveLength(3);
      expect(selection.additional).toEqual([]);
      expect(selection.all).toHaveLength(3);
    });

    it("adds no extras once mandatory responders already meet the target", () => {
      const selection = selectResponders({
        characters: cast,
        mentionedHandles: ["skeptic", "kansai"],
        explicitIds: [],
        minResponders: 2,
        maxResponders: 2,
        rng: makeRng([0, 0.5]),
      });

      expect(selection.additional).toEqual([]);
      expect(selection.all).toHaveLength(2);
    });

    it("does not blow up when the candidate pool is empty", () => {
      const selection = selectResponders({
        characters: [],
        mentionedHandles: ["skeptic"],
        explicitIds: ["c-architect"],
        minResponders: 2,
        maxResponders: 6,
        rng: makeRng([0.5]),
      });

      expect(selection.mandatory).toEqual([]);
      expect(selection.additional).toEqual([]);
      expect(selection.all).toEqual([]);
    });

    it("stops sampling when the pool runs out instead of looping forever", () => {
      const selection = selectResponders({
        characters: [architect, skeptic],
        mentionedHandles: [],
        explicitIds: [],
        minResponders: 6,
        maxResponders: 6,
        rng: makeRng([0, 0.5]),
      });

      expect(selection.all).toHaveLength(2);
    });
  });

  describe("weighted sampling", () => {
    it("favours a chatty character over a quiet one", () => {
      // The quiet character is listed first so position cannot explain the result.
      const quiet = makeCharacter({
        id: "c-quiet",
        handle: "quiet",
        activityLevel: 0.05,
        responseProbability: 0,
      });
      const chatty = makeCharacter({
        id: "c-chatty",
        handle: "chatty",
        activityLevel: 1,
        responseProbability: 1,
      });

      let chattyPicks = 0;
      let quietPicks = 0;

      for (let step = 0; step < 100; step += 1) {
        const selection = selectResponders({
          characters: [quiet, chatty],
          mentionedHandles: [],
          explicitIds: [],
          minResponders: 1,
          maxResponders: 1,
          rng: makeRng([0, step / 100]),
        });

        expect(selection.additional).toHaveLength(1);
        if (ids(selection.additional).includes("c-chatty")) chattyPicks += 1;
        else quietPicks += 1;
      }

      expect(chattyPicks + quietPicks).toBe(100);
      expect(chattyPicks).toBeGreaterThan(90);
      expect(chattyPicks).toBeGreaterThan(quietPicks * 10);
    });

    it("still gives a quiet character a non-zero chance", () => {
      const quiet = makeCharacter({
        id: "c-quiet",
        handle: "quiet",
        activityLevel: 0,
        responseProbability: 0,
      });
      const chatty = makeCharacter({
        id: "c-chatty",
        handle: "chatty",
        activityLevel: 1,
        responseProbability: 1,
      });

      const selection = selectResponders({
        characters: [quiet, chatty],
        mentionedHandles: [],
        explicitIds: [],
        minResponders: 1,
        maxResponders: 1,
        rng: makeRng([0, 0]),
      });

      expect(ids(selection.additional)).toEqual(["c-quiet"]);
    });
  });
});

describe("shouldRespond", () => {
  const eager = makeCharacter({ id: "c-eager", handle: "eager", responseProbability: 1 });

  it("essentially never responds when responseProbability is 0", () => {
    const silent = makeCharacter({ id: "c-silent", handle: "silent", responseProbability: 0 });

    for (let step = 0; step < 100; step += 1) {
      const responded = shouldRespond(silent, {
        authorInfluence: 1,
        depth: 0,
        rng: makeRng([step / 100]),
      });
      expect(responded).toBe(false);
    }
  });

  it("responds when responseProbability is 1.0 and the rng draw is low", () => {
    expect(
      shouldRespond(eager, { authorInfluence: 0.6, depth: 0, rng: makeRng([0.01]) }),
    ).toBe(true);
  });

  it("stops responding at a deeper cascade level for the same rng draw", () => {
    const rngValue = 0.45;

    expect(
      shouldRespond(eager, { authorInfluence: 0.5, depth: 0, rng: makeRng([rngValue]) }),
    ).toBe(true);
    expect(
      shouldRespond(eager, { authorInfluence: 0.5, depth: 1, rng: makeRng([rngValue]) }),
    ).toBe(false);
    expect(
      shouldRespond(eager, { authorInfluence: 0.5, depth: 4, rng: makeRng([rngValue]) }),
    ).toBe(false);
  });

  it("lowers the response chance monotonically as depth increases", () => {
    const countsByDepth = [0, 1, 2, 3, 4].map((depth) => {
      let responded = 0;
      for (let step = 0; step < 100; step += 1) {
        if (shouldRespond(eager, { authorInfluence: 0.6, depth, rng: makeRng([step / 100]) })) {
          responded += 1;
        }
      }
      return responded;
    });

    for (let index = 1; index < countsByDepth.length; index += 1) {
      const previous = countsByDepth[index - 1] ?? 0;
      const current = countsByDepth[index] ?? 0;
      expect(current).toBeLessThan(previous);
    }
  });

  it("raises the response chance as the author's influence grows", () => {
    const rngValue = 0.55;

    expect(
      shouldRespond(eager, { authorInfluence: 0.1, depth: 0, rng: makeRng([rngValue]) }),
    ).toBe(false);
    expect(
      shouldRespond(eager, { authorInfluence: 0.3, depth: 0, rng: makeRng([rngValue]) }),
    ).toBe(true);
    expect(
      shouldRespond(eager, { authorInfluence: 0.9, depth: 0, rng: makeRng([rngValue]) }),
    ).toBe(true);
  });

  it("counts more responses for an influential author than a weak one across the rng range", () => {
    const countFor = (authorInfluence: number): number => {
      let responded = 0;
      for (let step = 0; step < 100; step += 1) {
        if (shouldRespond(eager, { authorInfluence, depth: 1, rng: makeRng([step / 100]) })) {
          responded += 1;
        }
      }
      return responded;
    };

    expect(countFor(0.9)).toBeGreaterThan(countFor(0.1));
  });
});
