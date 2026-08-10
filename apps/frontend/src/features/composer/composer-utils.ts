/**
 * Appends a profile mention without duplicating an existing mention token.
 * React StrictMode may run the consuming effect twice in development, so this
 * operation must be idempotent.
 */
export function appendMentionOnce(content: string, handle: string): string {
  const normalizedHandle = handle.toLowerCase();
  const alreadyMentioned = [...content.matchAll(/(?:^|[^a-z0-9_])@([a-z0-9_]+)/giu)]
    .some((match) => match[1]?.toLowerCase() === normalizedHandle);
  if (alreadyMentioned) return content;

  const needsSpace = content.length > 0 && !/[\s\n]$/u.test(content) ? " " : "";
  return `${content}${needsSpace}@${handle} `;
}
