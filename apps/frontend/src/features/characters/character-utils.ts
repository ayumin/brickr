/** Maximum number of Unicode characters shown in the sidebar profile preview. */
export const PROFILE_PREVIEW_LENGTH = 30;

export function truncateProfile(description: string): string {
  const characters = Array.from(description);
  if (characters.length <= PROFILE_PREVIEW_LENGTH) return description;
  return `${characters.slice(0, PROFILE_PREVIEW_LENGTH - 1).join("")}…`;
}
