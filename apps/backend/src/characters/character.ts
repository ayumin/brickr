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

  /**
   * Selects the BehaviorProfile that governs autonomous Cast participation
   * (response timing, cooldown, concurrency).  Null / absent means the
   * `casual` default profile is used.  See `behavior-profiles.ts`.
   */
  behaviorProfileKey?: string | null;

  /**
   * Whether this character may join rooms autonomously as a Cast member.
   * Defaults to true.  The Cast creator can disable it to keep the character
   * purely reactive (only responds when explicitly invited or mentioned).
   */
  castAutonomous?: boolean;

  modelProfileId: string;
  avatarUrl?: string;
  /** Present when the character is logically deleted. */
  deletedAt?: Date;

  /** Absent for seed Characters — "System-owned", forever (CLAUDE.md §66.14). */
  createdByUserId?: string;
};

/** Seed shape: behaviour values may be omitted and fall back to defaults. */
export type CharacterSeed = Omit<
  Character,
  | "deletedAt"
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

/**
 * The writable shape. `createdByUserId` is deliberately excluded: it is set once
 * at creation and never touched by an update (CLAUDE.md §66.5).
 */
export type SaveCharacter = Omit<Character, "id" | "deletedAt" | "createdByUserId">;
