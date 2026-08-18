/**
 * Unit tests for CastParticipationResolver (issue #177).
 *
 * Covers:
 *   - Feed Room (scope: 'global'): all active characters are returned,
 *     regardless of membership rows.
 *   - Regular Room (scope: 'room'): only characters with an active Cast
 *     membership are returned.
 *   - Empty results when there are no eligible candidates.
 */

import { describe, expect, it, vi } from "vitest";
import type { Character } from "../characters/character.js";
import type { CharacterRepository } from "../characters/character-repository.js";
import type { RoomMembershipRepository } from "./room-membership-repository.js";
import { CastParticipationResolver } from "./cast-participation-resolver.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCharacter(id: string, overrides: Partial<Character> = {}): Character {
  return {
    id,
    handle: id,
    displayName: id,
    description: "desc",
    rolePrompt: "role",
    tonePrompt: "tone",
    interests: [],
    activityLevel: 0.5,
    responseProbability: 0.5,
    replyProbability: 0.5,
    quoteProbability: 0.2,
    influence: 0.5,
    castAutonomous: true,
    modelProfileId: "profile-1",
    ...overrides,
  };
}

const charA = makeCharacter("char-a");
const charB = makeCharacter("char-b");
const charC = makeCharacter("char-c");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResolver(
  allCharacters: Character[],
  activeCastIds: string[],
  byIds?: Character[],
): CastParticipationResolver {
  const characterRepo: Pick<CharacterRepository, "findAll" | "findByIds"> = {
    findAll: vi.fn().mockResolvedValue(allCharacters),
    findByIds: vi.fn().mockResolvedValue(byIds ?? allCharacters.filter((c) => activeCastIds.includes(c.id))),
  };

  const membershipRepo: Pick<RoomMembershipRepository, "findActiveCastIds"> = {
    findActiveCastIds: vi.fn().mockResolvedValue(activeCastIds),
  };

  return new CastParticipationResolver(
    characterRepo as CharacterRepository,
    membershipRepo as RoomMembershipRepository,
  );
}

// ---------------------------------------------------------------------------
// Feed Room (scope: 'global')
// ---------------------------------------------------------------------------

describe("CastParticipationResolver — Feed Room (scope: global)", () => {
  it("returns all active characters without querying memberships", async () => {
    const resolver = makeResolver([charA, charB, charC], []);
    const result = await resolver.resolveRespondingCasts({
      roomId: "feed-room",
      roomScope: "global",
    });

    expect(result).toEqual([charA, charB, charC]);
    // Membership lookup must not be called for the Feed room.
    expect(
      (resolver as unknown as { membershipRepo: { findActiveCastIds: ReturnType<typeof vi.fn> } })
        .membershipRepo.findActiveCastIds,
    ).not.toHaveBeenCalled();
  });

  it("returns an empty array when there are no characters", async () => {
    const resolver = makeResolver([], []);
    const result = await resolver.resolveRespondingCasts({
      roomId: "feed-room",
      roomScope: "global",
    });

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Regular Room (scope: 'room')
// ---------------------------------------------------------------------------

describe("CastParticipationResolver — Regular Room (scope: room)", () => {
  it("returns only characters with an active Cast membership", async () => {
    // charA and charB are active members; charC is not.
    const resolver = makeResolver([charA, charB, charC], ["char-a", "char-b"]);
    const result = await resolver.resolveRespondingCasts({
      roomId: "room-1",
      roomScope: "room",
    });

    expect(result).toEqual([charA, charB]);
  });

  it("returns an empty array when there are no active Cast members", async () => {
    const resolver = makeResolver([charA, charB], []);
    const result = await resolver.resolveRespondingCasts({
      roomId: "room-1",
      roomScope: "room",
    });

    expect(result).toEqual([]);
  });

  it("does not call findAll for a regular room", async () => {
    const resolver = makeResolver([charA], ["char-a"]);
    await resolver.resolveRespondingCasts({ roomId: "room-1", roomScope: "room" });

    // findAll should not be called; only findByIds is used.
    expect(
      (resolver as unknown as { characterRepo: { findAll: ReturnType<typeof vi.fn> } })
        .characterRepo.findAll,
    ).not.toHaveBeenCalled();
  });

  it("returns an empty array when active Cast IDs exist but characters are not found", async () => {
    // Simulate a case where membership IDs exist but the character rows are gone.
    const resolver = makeResolver([], ["char-deleted"], []);
    const result = await resolver.resolveRespondingCasts({
      roomId: "room-1",
      roomScope: "room",
    });

    expect(result).toEqual([]);
  });

  it("queries memberships with the correct roomId", async () => {
    const membershipRepo: Pick<RoomMembershipRepository, "findActiveCastIds"> = {
      findActiveCastIds: vi.fn().mockResolvedValue(["char-a"]),
    };
    const characterRepo: Pick<CharacterRepository, "findAll" | "findByIds"> = {
      findAll: vi.fn(),
      findByIds: vi.fn().mockResolvedValue([charA]),
    };

    const resolver = new CastParticipationResolver(
      characterRepo as CharacterRepository,
      membershipRepo as RoomMembershipRepository,
    );

    await resolver.resolveRespondingCasts({ roomId: "specific-room", roomScope: "room" });

    expect(membershipRepo.findActiveCastIds).toHaveBeenCalledWith("specific-room");
    expect(characterRepo.findByIds).toHaveBeenCalledWith(["char-a"]);
  });
});
