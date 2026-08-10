import { MAX_POST_LENGTH } from "@brickr/shared";

/**
 * Cleans up raw LLM output into something that reads like an SNS post.
 *
 * Models reliably add a few artefacts no matter how the prompt is worded:
 * wrapping quotes, a `@handle:` byline, markdown fences, a leading label.
 * Pure function so the behaviour is unit tested.
 */
export function sanitizeGeneratedPost(raw: string, ownHandle: string): string {
  let text = raw.trim();

  text = stripCodeFence(text);
  text = stripOwnByline(text, ownHandle);
  text = stripWrappingQuotes(text);
  text = text.replace(/^\s*(投稿|本文|返信|引用)\s*[:：]\s*/u, "");

  // Collapse runs of blank lines; a post is not a document.
  text = text.replace(/\n{3,}/gu, "\n\n").trim();

  if (text.length > MAX_POST_LENGTH) {
    text = `${text.slice(0, MAX_POST_LENGTH - 1).trimEnd()}…`;
  }

  return text;
}

function stripCodeFence(text: string): string {
  const fenced = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/u.exec(text);
  return fenced?.[1]?.trim() ?? text;
}

/** Removes a `@self:` / `自分の名前:` byline the model prepended. */
function stripOwnByline(text: string, ownHandle: string): string {
  const pattern = new RegExp(`^@${escapeRegExp(ownHandle)}\\s*[:：]\\s*`, "iu");
  return text.replace(pattern, "").trimStart();
}

function stripWrappingQuotes(text: string): string {
  const pairs: ReadonlyArray<readonly [string, string]> = [
    ["「", "」"],
    ["『", "』"],
    ['"', '"'],
    ["“", "”"],
    ["'", "'"],
  ];

  for (const [open, close] of pairs) {
    if (text.length > open.length + close.length && text.startsWith(open) && text.endsWith(close)) {
      const inner = text.slice(open.length, text.length - close.length);
      // Only unwrap when the quotes really are wrapping the whole thing.
      if (!inner.includes(close)) return inner.trim();
    }
  }

  return text;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
