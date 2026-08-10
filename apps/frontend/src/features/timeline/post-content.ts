export type PostContentToken =
  | { kind: "text"; value: string }
  | { kind: "url"; value: string }
  | { kind: "mention"; value: string; handle: string };

const CONTENT_TOKEN_PATTERN =
  /https?:\/\/[^\s<>"'。、！？，．「」『』【】《》〈〉]+|@([A-Za-z0-9_]{1,32})/gu;
const SIMPLE_TRAILING_PUNCTUATION = /[.,!?;。、！？，．」』】》〉]$/u;

/**
 * Splits a post body without ever interpreting it as HTML.
 * URL matching takes priority, so an @ inside a URL is not treated as a mention.
 */
export function tokenizePostContent(content: string): PostContentToken[] {
  const tokens: PostContentToken[] = [];
  let cursor = 0;

  for (const match of content.matchAll(CONTENT_TOKEN_PATTERN)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    if (start > cursor) pushText(tokens, content.slice(cursor, start));

    const matched = match[0];
    const handle = match[1];
    if (handle !== undefined) {
      tokens.push({ kind: "mention", value: matched, handle });
    } else {
      const { url, trailing } = splitTrailingPunctuation(matched);
      if (url.length > 0) tokens.push({ kind: "url", value: url });
      if (trailing.length > 0) pushText(tokens, trailing);
    }
    cursor = start + matched.length;
  }

  if (cursor < content.length) pushText(tokens, content.slice(cursor));
  return tokens;
}

function pushText(tokens: PostContentToken[], value: string): void {
  if (value.length === 0) return;
  const previous = tokens[tokens.length - 1];
  if (previous?.kind === "text") previous.value += value;
  else tokens.push({ kind: "text", value });
}

function splitTrailingPunctuation(value: string): { url: string; trailing: string } {
  let end = value.length;
  while (end > 0 && SIMPLE_TRAILING_PUNCTUATION.test(value.slice(0, end))) end -= 1;

  for (const [open, close] of [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ] as const) {
    while (
      value[end - 1] === close &&
      count(value.slice(0, end), close) > count(value.slice(0, end), open)
    ) {
      end -= 1;
    }
  }

  return { url: value.slice(0, end), trailing: value.slice(end) };
}

function count(value: string, character: string): number {
  return Array.from(value).filter((current) => current === character).length;
}
