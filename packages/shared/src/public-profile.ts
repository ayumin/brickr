/**
 * The one shape every public screen uses for an account.
 *
 * People and characters resolve to the same type on purpose: a reader must not be
 * able to tell them apart before reading the post (Brickr-ux-refine §9.1, §25).
 * Anything that would give it away — owner type, model profile,
 * `createdByUserId`, persona prompts, behaviour probabilities, token usage —
 * stays in the authenticated management DTOs.
 */
export type PublicAccountDto = {
  id: string;
  handle: string;
  displayName: string;
  description?: string;
  avatarUrl?: string;
};

/**
 * One account's profile screen, for people and characters alike (§9.2, §10.6).
 *
 * There is deliberately no owner type here, and no discriminated union around
 * it: a union would leak the very distinction the shared shape exists to hide,
 * because the type itself would name it.
 *
 * `canEdit` is the only capability the screen needs, and it is safe to publish
 * precisely because it is **also true on your own profile**. Seeing `true`
 * therefore proves nothing about whether the account is a character, so the
 * frontend must follow it rather than reason from it (§21): "not me but
 * editable" is not a character test and must never be written as one.
 */
export type PublicProfileDto = PublicAccountDto & {
  /** Posts the caller may actually see, so the number matches the list below it. */
  postCount: number;
  canEdit: boolean;
};

export type PublicProfileResponse = {
  profile: PublicProfileDto;
};
