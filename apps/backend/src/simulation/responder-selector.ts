import type { Character } from "../characters/character.js";

/** Injectable randomness so selection is unit-testable. */
export type Rng = () => number;

const defaultRng: Rng = Math.random;

export type ResponderSelectionInput = {
  characters: Character[];
  /** Handles found in the post body. These characters always respond. */
  mentionedHandles: string[];
  /** Character ids the user explicitly picked in the UI. Always respond. */
  explicitIds: string[];
  /** Characters that must not be picked — the post's own author, or already-responded. */
  excludeIds?: string[];
  minResponders: number;
  maxResponders: number;
  rng?: Rng;
};

export type ResponderSelection = {
  /** Mentioned + explicitly selected, in that priority order. */
  mandatory: Character[];
  /** Randomly sampled extras. */
  additional: Character[];
  /** `mandatory` followed by `additional`. */
  all: Character[];
};

/** Picks one item from `pool` with probability proportional to `weightOf`. */
function weightedPick(
  pool: Character[],
  weightOf: (character: Character) => number,
  rng: Rng,
): Character | undefined {
  if (pool.length === 0) return undefined;

  const weights = pool.map((character) => Math.max(weightOf(character), 0.01));
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  let threshold = rng() * total;
  for (let index = 0; index < pool.length; index += 1) {
    threshold -= weights[index] ?? 0;
    if (threshold <= 0) return pool[index];
  }
  return pool[pool.length - 1];
}

/**
 * Decides who reacts to a post.
 *
 * Priority, per CLAUDE.md §34:
 *   1. mentioned characters
 *   2. characters the user explicitly selected
 *   3. a random handful of the rest, weighted by how chatty they are
 */
export function selectResponders(input: ResponderSelectionInput): ResponderSelection {
  const rng = input.rng ?? defaultRng;
  const excluded = new Set(input.excludeIds ?? []);

  const byHandle = new Map<string, Character>();
  const byId = new Map<string, Character>();
  for (const character of input.characters) {
    byHandle.set(character.handle.toLowerCase(), character);
    byId.set(character.id, character);
  }

  const chosen = new Map<string, Character>();
  const mandatory: Character[] = [];

  const addMandatory = (character: Character | undefined): void => {
    if (!character) return;
    if (excluded.has(character.id) || chosen.has(character.id)) return;
    chosen.set(character.id, character);
    mandatory.push(character);
  };

  for (const handle of input.mentionedHandles) {
    addMandatory(byHandle.get(handle.toLowerCase()));
  }
  for (const id of input.explicitIds) {
    addMandatory(byId.get(id));
  }

  // Sample extras up to a target count somewhere in [min, max].
  const maxResponders = Math.max(input.maxResponders, input.minResponders);
  const span = maxResponders - input.minResponders + 1;
  const target = input.minResponders + Math.floor(rng() * span);

  const pool = input.characters.filter(
    (character) => !excluded.has(character.id) && !chosen.has(character.id),
  );

  const additional: Character[] = [];
  while (chosen.size < Math.min(target, maxResponders) && pool.length > 0) {
    const picked = weightedPick(
      pool,
      (character) => character.activityLevel * (0.5 + character.responseProbability),
      rng,
    );
    if (!picked) break;

    pool.splice(pool.indexOf(picked), 1);
    chosen.set(picked.id, picked);
    additional.push(picked);
  }

  return { mandatory, additional, all: [...mandatory, ...additional] };
}

/**
 * Gate for cascade rounds: once a character has posted, which *other*
 * characters get drawn in to answer it.
 *
 * Mandatory responders bypass this — it only applies to opportunistic reactions.
 */
export function shouldRespond(
  character: Character,
  options: { authorInfluence: number; depth: number; rng?: Rng },
): boolean {
  const rng = options.rng ?? defaultRng;
  // Each cascade level makes reactions rarer, so conversations wind down.
  const decay = 1 / (1 + options.depth);
  const chance =
    character.responseProbability * (0.4 + options.authorInfluence) * decay;
  return rng() < chance;
}
