import type { CharacterManagementDto } from "@brickr/shared";

/**
 * Mirrors the backend's Character ownership check (CLAUDE.md §66.5): only the
 * creator or an admin may edit/delete. `createdByUserId` itself is already
 * omitted by the backend for anyone else's characters, so a row with none is
 * either someone else's or a System-owned seed - either way, not manageable
 * unless the viewer is an admin.
 */
export function canManageCharacter(
  character: Pick<CharacterManagementDto, "createdByUserId">,
  currentUserId: string,
  isAdmin: boolean,
): boolean {
  return isAdmin || character.createdByUserId === currentUserId;
}
