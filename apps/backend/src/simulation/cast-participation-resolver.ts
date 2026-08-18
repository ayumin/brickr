/**
 * Cast participation resolver (issue #177).
 *
 * Resolves which Cast characters are eligible to respond in a given room:
 *
 *   - Feed Room (scope: 'global'): all active (non-deleted) Cast characters,
 *     regardless of membership. The Feed room has no membership rows and all
 *     Casts are implicitly participants.
 *   - Regular Room (scope: 'room'): only Cast characters that hold an active
 *     membership in that room.
 *
 * This single resolver replaces the ad-hoc `findAll()` calls scattered across
 * SimulationService, ThreadRevivalService, and RoomReviewService, ensuring
 * consistent Cast selection logic across all event types.
 *
 * Design notes:
 *   - The resolver is a plain class with no framework dependencies so it is
 *     easy to unit-test with mocks.
 *   - `resolveRespondingCasts` is the only public method; callers do not need
 *     to know whether the room is a Feed room or a regular room.
 *   - For regular rooms, the membership lookup is done first so the character
 *     query is bounded by the number of active Cast members rather than the
 *     total character count.
 */

import type { Character } from "../characters/character.js";
import type { CharacterRepository } from "../characters/character-repository.js";
import type { RoomMembershipRepository } from "./room-membership-repository.js";
import type { RoomScope } from "./simulation.js";

export type CastParticipationContext = {
  roomId: string;
  roomScope: RoomScope;
};

export class CastParticipationResolver {
  constructor(
    private readonly characterRepo: CharacterRepository,
    private readonly membershipRepo: RoomMembershipRepository,
  ) {}

  /**
   * Returns the Cast characters eligible to respond in the given room.
   *
   * Feed Room: all active (non-deleted) Cast characters.
   * Regular Room: only Cast characters with an active membership in the room.
   */
  async resolveRespondingCasts(ctx: CastParticipationContext): Promise<Character[]> {
    if (ctx.roomScope === "global") {
      // Feed Room: all active characters are implicitly participants.
      return this.characterRepo.findAll();
    }

    // Regular Room: only characters with an active Cast membership.
    const activeCastIds = await this.membershipRepo.findActiveCastIds(ctx.roomId);
    if (activeCastIds.length === 0) return [];

    // `findByIds` applies `deletedAt: null`, so soft-deleted characters are
    // excluded here just as they are in `findAll()` above.
    return this.characterRepo.findByIds(activeCastIds);
  }
}
