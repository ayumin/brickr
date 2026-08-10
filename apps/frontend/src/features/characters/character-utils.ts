/** Maximum number of Unicode characters shown in the sidebar profile preview. */
export const PROFILE_PREVIEW_LENGTH = 30;

export function truncateProfile(description: string): string {
  return truncateText(description, PROFILE_PREVIEW_LENGTH);
}

/** Truncates by Unicode code point and includes the ellipsis in the limit. */
export function truncateText(value: string, maximumLength: number): string {
  if (maximumLength < 1) return "";
  const characters = Array.from(value);
  if (characters.length <= maximumLength) return value;
  return `${characters.slice(0, maximumLength - 1).join("")}…`;
}

export function compareOptionalNumbers(
  left: number | undefined,
  right: number | undefined,
  direction: "asc" | "desc",
): number {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  const difference = left - right;
  return direction === "asc" ? difference : -difference;
}

export function parseBulkCharacterCount(value: string): number | null {
  if (!/^(?:[1-9]|[1-9]\d|100)$/u.test(value)) return null;
  return Number(value);
}
