/**
 * Cast recommendation, join-request, and welcome-event logic (issue #164).
 *
 * Responsibilities:
 *   1. Score candidate characters against a room using interests/tags overlap
 *      and an active-room-count penalty (lightweight pre-filter).
 *   2. Pass the top-N candidates to the LLM for a structured yes/no decision.
 *   3. Apply the visibility-specific join rules:
 *        public  → immediate active membership
 *        open    → pending membership (owner approval required)
 *        closed  → pending membership (invitation-only, but Cast may request)
 *        private → autonomous join skipped (owner invitation required)
 *   4. Enforce the per-room pending-Cast limit and the ban exclusion.
 *   5. Produce a `character.join.welcome` post after a Cast becomes active.
 *
 * Design notes:
 *   - LLM failure is safe-side: if the LLM call fails the Cast does not join.
 *   - `castAutonomous = false` characters are never recommended.
 *   - Banned characters are excluded from the candidate pool.
 *   - The pending limit is per-room (default: 3 simultaneous pending Casts).
 */

import { z } from "zod";
import type { Character } from "../characters/character.js";
import type { CharacterRepository } from "../characters/character-repository.js";
import type { LLMClient } from "../llm/llm-client.js";
import type { LLMProviderRegistry } from "../llm/provider-registry.js";
import type { PostService } from "../posts/post-service.js";
import type { RoomRepository } from "./room-repository.js";
import type { RoomMembershipRepository } from "./room-membership-repository.js";
import type { Room } from "./room.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of candidates forwarded to the LLM for structured judgment. */
const LLM_CANDIDATE_LIMIT = 5;

/** Maximum simultaneous pending Cast memberships per room. */
const MAX_PENDING_CASTS = 3;

/** Score weight per matching interest tag. */
const TAG_MATCH_WEIGHT = 10;

/** Score penalty per active room the character already belongs to. */
const ACTIVE_ROOM_PENALTY = 2;

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Computes a lightweight relevance score for a character against a room.
 *
 * Higher is better. The score is used only for pre-filtering; the LLM makes
 * the final binary decision.
 *
 * @param character  The candidate Cast character.
 * @param roomTags   The room's tag list (may be empty).
 * @param activeRoomCount  How many active rooms the character already belongs to.
 */
export function scoreCastForRoom(
  character: Character,
  roomTags: string[],
  activeRoomCount: number,
): number {
  const matchingTags = character.interests.filter((interest) =>
    roomTags.includes(interest),
  );
  return matchingTags.length * TAG_MATCH_WEIGHT - activeRoomCount * ACTIVE_ROOM_PENALTY;
}

// ---------------------------------------------------------------------------
// LLM judgment
// ---------------------------------------------------------------------------

const joinDecisionSchema = z.object({
  shouldJoin: z.boolean(),
  reason: z.string(),
});

const joinDecisionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    shouldJoin: { type: "boolean" },
    reason: { type: "string" },
  },
  required: ["shouldJoin", "reason"],
};

export type JoinDecision = z.infer<typeof joinDecisionSchema>;

/**
 * Asks the LLM whether a character should join a room.
 *
 * Returns `{ shouldJoin: false }` on any LLM failure (safe-side fallback).
 */
export async function askLlmShouldJoin(
  llm: LLMClient,
  providers: LLMProviderRegistry,
  character: Character,
  room: Room,
): Promise<JoinDecision> {
  const provider = providers.preferred();
  if (!provider) {
    return { shouldJoin: false, reason: "no LLM provider available" };
  }

  const roomName = room.title ?? "(無題のルーム)";
  const interests = character.interests.length > 0 ? character.interests.join(", ") : "なし";

  try {
    const result = await llm.generate(provider.id, {
      model: provider.defaultModel,
      systemPrompt:
        "あなたはSNSルームへのキャラクター参加を判断するシステムです。" +
        "キャラクターの説明と興味、ルーム名だけを根拠に、そのキャラクターがルームに参加すべきかを判断してください。" +
        "JSON以外は返さないでください。",
      messages: [
        {
          role: "user",
          content:
            `キャラクター名: ${character.displayName}\n` +
            `キャラクター説明: ${character.description}\n` +
            `興味・関心: ${interests}\n` +
            `ルーム名: ${roomName}\n` +
            `このキャラクターはこのルームに参加すべきですか？`,
        },
      ],
      maxOutputTokens: 200,
      temperature: 0.3,
      structuredOutput: {
        name: "join_decision",
        schema: joinDecisionJsonSchema,
      },
    });

    const start = result.text.indexOf("{");
    const end = result.text.lastIndexOf("}");
    if (start < 0 || end < start) {
      return { shouldJoin: false, reason: "LLM response was not valid JSON" };
    }
    return joinDecisionSchema.parse(JSON.parse(result.text.slice(start, end + 1)));
  } catch {
    // Safe-side: if the LLM call fails, the Cast does not join.
    return { shouldJoin: false, reason: "LLM call failed" };
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export type CastJoinServiceDeps = {
  rooms: RoomRepository;
  characters: CharacterRepository;
  memberships: RoomMembershipRepository;
  posts: PostService;
  llm: LLMClient;
  providers: LLMProviderRegistry;
};

export type CastJoinResult =
  | { outcome: "joined"; characterId: string }
  | { outcome: "pending"; characterId: string }
  | { outcome: "skipped"; reason: string }
  | { outcome: "error"; reason: string };

/**
 * Selects and processes Cast candidates for a room.
 *
 * Called by the `character.join.request` event handler. Picks the best
 * candidates, runs LLM judgment, and creates membership records according to
 * the room's visibility rules.
 *
 * Returns one result per candidate that was evaluated.
 */
export async function processCastJoinRequests(
  roomId: string,
  deps: CastJoinServiceDeps,
): Promise<CastJoinResult[]> {
  const room = await deps.rooms.findById(roomId);
  if (!room || room.status === "archived") {
    return [{ outcome: "skipped", reason: "room not found or archived" }];
  }

  // Private rooms are invitation-only. Short-circuit before loading/scoring
  // candidates or spending LLM budget on a decision that cannot be applied.
  if (room.visibility === "private") {
    return [{ outcome: "skipped", reason: "private room requires an invitation" }];
  }

  // Load all non-deleted characters.
  const allCharacters = await deps.characters.findAll();

  // Exclude characters that are already members, pending approval, or banned.
  const [activeCastIds, pendingCastIds, bannedCastIds] = await Promise.all([
    deps.memberships.findActiveCastIds(roomId),
    deps.memberships.findPendingCastIds(roomId),
    deps.memberships.findBannedCastIds(roomId),
  ]);
  const excludedIds = new Set([
    ...activeCastIds,
    ...pendingCastIds,
    ...bannedCastIds,
  ]);

  // Only autonomous characters are eligible.
  const candidates = allCharacters.filter(
    (c) => c.castAutonomous !== false && !excludedIds.has(c.id),
  );

  if (candidates.length === 0) {
    return [{ outcome: "skipped", reason: "no eligible candidates" }];
  }

  // Check the pending limit before doing any LLM work.
  const pendingCount = await deps.memberships.countPendingCasts(roomId);
  if (pendingCount >= MAX_PENDING_CASTS) {
    return [{ outcome: "skipped", reason: "pending Cast limit reached" }];
  }

  // Score and pick the top candidates.
  const roomTags = room.tags;
  const scored = await Promise.all(
    candidates.map(async (c) => {
      const activeRoomCount = await deps.memberships.countActiveRoomsForCast(c.id);
      return { character: c, score: scoreCastForRoom(c, roomTags, activeRoomCount) };
    }),
  );
  scored.sort((a, b) => b.score - a.score);

  // How many slots remain before hitting the pending limit?
  const slotsAvailable = MAX_PENDING_CASTS - pendingCount;
  const topCandidates = scored.slice(0, Math.min(LLM_CANDIDATE_LIMIT, slotsAvailable));

  const results: CastJoinResult[] = [];

  for (const { character } of topCandidates) {
    const result = await processSingleCandidate(character, room, deps);
    results.push(result);
    // Stop if we've filled the pending slots.
    if (result.outcome === "pending" || result.outcome === "joined") {
      const newPendingCount = await deps.memberships.countPendingCasts(roomId);
      if (newPendingCount >= MAX_PENDING_CASTS) break;
    }
  }

  return results;
}

async function processSingleCandidate(
  character: Character,
  room: Room,
  deps: CastJoinServiceDeps,
): Promise<CastJoinResult> {
  // LLM judgment — safe-side: skip if LLM says no or fails.
  const decision = await askLlmShouldJoin(deps.llm, deps.providers, character, room);
  if (!decision.shouldJoin) {
    return { outcome: "skipped", reason: `LLM declined: ${decision.reason}` };
  }

  // Apply visibility rules.
  const { visibility } = room;

  try {
    if (visibility === "public") {
      // Immediate active membership.
      await deps.memberships.create({
        roomId: room.id,
        memberKind: "character",
        memberId: character.id,
        role: "member",
        status: "active",
      });
      return { outcome: "joined", characterId: character.id };
    } else {
      // open / closed → pending (owner approval required).
      await deps.memberships.create({
        roomId: room.id,
        memberKind: "character",
        memberId: character.id,
        role: "member",
        status: "pending",
      });
      return { outcome: "pending", characterId: character.id };
    }
  } catch (error) {
    return {
      outcome: "error",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

// ---------------------------------------------------------------------------
// Welcome post
// ---------------------------------------------------------------------------

/**
 * Publishes a welcome post from a Cast character that has just become an active
 * member of a room.
 *
 * Called by the `character.join.welcome` event handler. The post is generated
 * by the LLM using the character's persona. Returns the actual outcome so the
 * worker can distinguish publication, a normal skip, and a non-fatal failure.
 */
export async function publishWelcomePost(
  roomId: string,
  characterId: string,
  deps: Pick<CastJoinServiceDeps, "rooms" | "characters" | "posts" | "llm" | "providers">,
): Promise<WelcomePostResult> {
  const [room, character] = await Promise.all([
    deps.rooms.findById(roomId),
    deps.characters.findById(characterId),
  ]);

  if (!room || room.status === "archived") {
    return { outcome: "skipped", reason: "room not found or archived" };
  }
  if (!character) return { outcome: "skipped", reason: "character not found" };

  const provider = deps.providers.preferred();
  if (!provider) {
    return { outcome: "skipped", reason: "no LLM provider available" };
  }

  const roomName = room.title ?? "(無題のルーム)";

  try {
    const result = await deps.llm.generate(provider.id, {
      model: provider.defaultModel,
      systemPrompt:
        `あなたは「${character.displayName}」というキャラクターです。\n` +
        `${character.rolePrompt}\n` +
        `${character.tonePrompt}`,
      messages: [
        {
          role: "user",
          content:
            `あなたは「${roomName}」というルームに参加しました。` +
            `短い挨拶の投稿を1つ書いてください。140文字以内で、自然な口調で。`,
        },
      ],
      maxOutputTokens: 200,
      temperature: 0.8,
    });

    const content = result.text.trim();
    if (!content) {
      return { outcome: "skipped", reason: "LLM returned empty content" };
    }

    await deps.posts.publish({
      roomId,
      authorId: characterId,
      content,
      replyTo: null,
      quoteOf: null,
    });
    return { outcome: "published" };
  } catch (error) {
    // Welcome post failure is non-fatal: the membership is already committed.
    return {
      outcome: "error",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export type WelcomePostResult =
  | { outcome: "published" }
  | { outcome: "skipped"; reason: string }
  | { outcome: "error"; reason: string };
