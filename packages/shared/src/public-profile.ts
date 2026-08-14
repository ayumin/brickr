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
