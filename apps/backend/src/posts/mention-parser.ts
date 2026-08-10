/**
 * Parses `@handle` mentions out of post text.
 *
 * Pure function, no I/O — the unit tests for responder selection depend on this
 * being deterministic.
 */

/** Handles are ASCII: letters, digits and underscore. */
const MENTION_PATTERN = /@([A-Za-z0-9_]{1,32})/g;

/** True when `@` at `index` is a mention start rather than part of e.g. an address. */
function isMentionBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = text[index - 1];
  if (previous === undefined) return true;
  // "user@example.com" must not yield a mention of "example".
  return !/[A-Za-z0-9_@.]/.test(previous);
}

/**
 * Returns the mentioned handles in first-appearance order, lowercased and
 * de-duplicated. The leading "@" is stripped.
 */
export function parseMentions(content: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  for (const match of content.matchAll(MENTION_PATTERN)) {
    const handle = match[1];
    if (handle === undefined) continue;
    if (match.index === undefined) continue;
    if (!isMentionBoundary(content, match.index)) continue;

    const normalized = handle.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    found.push(normalized);
  }

  return found;
}

/**
 * Narrows parsed mentions to handles that actually exist.
 * Unknown handles are dropped rather than treated as errors — an LLM may
 * invent one, and that should not break a post.
 */
export function resolveKnownMentions(
  content: string,
  knownHandles: Iterable<string>,
): string[] {
  const known = new Set(Array.from(knownHandles, (h) => h.toLowerCase()));
  return parseMentions(content).filter((handle) => known.has(handle));
}
