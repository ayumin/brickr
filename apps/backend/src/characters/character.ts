/**
 * Character domain model.
 *
 * This is the backend's internal representation and includes persona prompts
 * and behaviour tuning. It is never returned from the public API — see
 * `toCharacterDto` for the shape the frontend receives.
 */
export type Character = {
  id: string;
  handle: string;
  displayName: string;
  description: string;

  /** How the character thinks and what it pays attention to. */
  rolePrompt: string;
  /** How the character talks. */
  tonePrompt: string;
  /** Optional dialect guidance (e.g. Kansai). */
  dialectPrompt?: string;

  interests: string[];

  /** 0..1 — general chattiness. */
  activityLevel: number;
  /** 0..1 — chance of responding at all when picked as a candidate. */
  responseProbability: number;
  /** 0..1 — relative weight of choosing `reply`. */
  replyProbability: number;
  /** 0..1 — relative weight of choosing `quote`. */
  quoteProbability: number;
  /** 0..1 — how often other characters get drawn into responding. */
  influence: number;

  modelProfileId: string;
  avatarUrl?: string;
};

/** Seed shape: behaviour values may be omitted and fall back to defaults. */
export type CharacterSeed = Omit<
  Character,
  | "activityLevel"
  | "responseProbability"
  | "replyProbability"
  | "quoteProbability"
  | "influence"
> &
  Partial<
    Pick<
      Character,
      | "activityLevel"
      | "responseProbability"
      | "replyProbability"
      | "quoteProbability"
      | "influence"
    >
  >;
