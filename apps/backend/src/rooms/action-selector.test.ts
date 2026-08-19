import { describe, expect, it } from "vitest";
import type { Character } from "../characters/character.js";
import type { Post } from "../posts/post.js";
import { resolveActionTargets, selectAction } from "./action-selector.js";
import type { Rng } from "./responder-selector.js";
import { RESPONSE_ACTIONS } from "./room.js";

/** Deterministic rng: queued values in order, then clamped to the last one. */
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
    handle: overrides.id,
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

function makePost(overrides: Partial<Post> & { id: string }): Post {
  return {
    roomId: "sim-1",
    authorId: "user-1",
    content: "RAGって本当に必要？",
    mentions: [],
    replyTo: null,
    quoteOf: null,
    threadRootId: overrides.id,
    threadActivityAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

/** rng draws spanning 0 up to just under 1. */
const RNG_SWEEP: readonly number[] = Array.from({ length: 100 }, (_unused, step) => step / 100);

const topLevelPost = makePost({ id: "post-1" });
const midThreadReply = makePost({ id: "post-2", replyTo: "post-1", authorId: "c-architect" });

describe("selectAction", () => {
  it("yields reply for a reply-heavy character across the rng range", () => {
    const replyHeavy = makeCharacter({
      id: "c-replier",
      replyProbability: 1,
      quoteProbability: 0,
    });

    for (const rngValue of RNG_SWEEP.filter((value) => value <= 0.95)) {
      expect(
        selectAction({
          character: replyHeavy,
          target: topLevelPost,
          threadPosts: [topLevelPost],
          rng: makeRng([rngValue]),
        }),
      ).toBe("reply");
    }
  });

  it("leaves only the standalone-post floor to a reply-heavy character", () => {
    // `postWeight` has a 0.05 floor, so even replyProbability 1.0 keeps a sliver
    // of probability mass for a standalone post. It is never a quote.
    const replyHeavy = makeCharacter({
      id: "c-replier",
      replyProbability: 1,
      quoteProbability: 0,
    });

    for (const rngValue of [0.96, 0.98, 0.99]) {
      expect(
        selectAction({
          character: replyHeavy,
          target: topLevelPost,
          threadPosts: [topLevelPost],
          rng: makeRng([rngValue]),
        }),
      ).toBe("post");
    }
  });

  it("can yield quote for a quote-leaning character on a top-level post", () => {
    const quoteLeaning = makeCharacter({
      id: "c-quoter",
      replyProbability: 0.1,
      quoteProbability: 0.8,
    });

    const actions = RNG_SWEEP.map((rngValue) =>
      selectAction({
        character: quoteLeaning,
        target: topLevelPost,
        threadPosts: [topLevelPost],
        rng: makeRng([rngValue]),
      }),
    );

    expect(actions).toContain("quote");
    expect(
      selectAction({
        character: quoteLeaning,
        target: topLevelPost,
        threadPosts: [topLevelPost],
        rng: makeRng([0.5]),
      }),
    ).toBe("quote");
  });

  it("never quotes a post that is itself a reply", () => {
    const quoteLeaning = makeCharacter({
      id: "c-quoter",
      replyProbability: 0.1,
      quoteProbability: 0.9,
    });

    for (const rngValue of RNG_SWEEP) {
      expect(
        selectAction({
          character: quoteLeaning,
          target: midThreadReply,
          threadPosts: [topLevelPost, midThreadReply],
          rng: makeRng([rngValue]),
        }),
      ).not.toBe("quote");
    }
  });

  it("never quotes a mid-thread reply even for a character that only ever quotes", () => {
    const alwaysQuote = makeCharacter({
      id: "c-alwaysquote",
      replyProbability: 0,
      quoteProbability: 1,
    });

    const actions = new Set(
      RNG_SWEEP.map((rngValue) =>
        selectAction({
          character: alwaysQuote,
          target: midThreadReply,
          threadPosts: [topLevelPost, midThreadReply],
          rng: makeRng([rngValue]),
        }),
      ),
    );

    expect(actions.has("quote")).toBe(false);
  });

  it("can yield a standalone post when reply and quote weights leave slack", () => {
    const balanced = makeCharacter({
      id: "c-balanced",
      replyProbability: 0.2,
      quoteProbability: 0.2,
    });

    const actions = RNG_SWEEP.map((rngValue) =>
      selectAction({
        character: balanced,
        target: topLevelPost,
        threadPosts: [topLevelPost],
        rng: makeRng([rngValue]),
      }),
    );

    expect(actions).toContain("post");
    expect(actions).toContain("reply");
    expect(actions).toContain("quote");
    expect(
      selectAction({
        character: balanced,
        target: topLevelPost,
        threadPosts: [topLevelPost],
        rng: makeRng([0.9]),
      }),
    ).toBe("post");
  });

  it("always returns one of the three valid actions for rng draws from 0 to just under 1", () => {
    const characters = [
      makeCharacter({ id: "c-a", replyProbability: 0, quoteProbability: 0 }),
      makeCharacter({ id: "c-b", replyProbability: 1, quoteProbability: 1 }),
      makeCharacter({ id: "c-c", replyProbability: 0.5, quoteProbability: 0.5 }),
    ];

    for (const character of characters) {
      for (const target of [topLevelPost, midThreadReply]) {
        for (const rngValue of [...RNG_SWEEP, 0.999, 0.9999]) {
          const action = selectAction({
            character,
            target,
            threadPosts: [topLevelPost, midThreadReply],
            rng: makeRng([rngValue]),
          });
          expect(RESPONSE_ACTIONS).toContain(action);
        }
      }
    }
  });
});

describe("resolveActionTargets", () => {
  it("points replyTo at the target and leaves quoteOf null for a reply", () => {
    expect(resolveActionTargets("reply", topLevelPost)).toEqual({
      replyTo: "post-1",
      quoteOf: null,
    });
  });

  it("points quoteOf at the target and leaves replyTo null for a quote", () => {
    expect(resolveActionTargets("quote", topLevelPost)).toEqual({
      replyTo: null,
      quoteOf: "post-1",
    });
  });

  it("leaves both null for a standalone post", () => {
    expect(resolveActionTargets("post", topLevelPost)).toEqual({
      replyTo: null,
      quoteOf: null,
    });
  });

  it("uses the target post id rather than any thread parent", () => {
    expect(resolveActionTargets("reply", midThreadReply)).toEqual({
      replyTo: "post-2",
      quoteOf: null,
    });
  });
});
