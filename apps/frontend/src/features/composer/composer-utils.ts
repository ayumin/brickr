import type { PostDto } from "@brickr/shared";
import type { ComposerContext } from "../../types";

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

/**
 * A reply/quote always targets the replied/quoted post's own room (§17.1),
 * never wherever the reader is currently looking — the unified feed has no
 * simulation of its own to post into.
 */
export function composerContextForReply(post: PostDto): ComposerContext {
  return { mode: "reply", simulationId: post.roomId, post };
}

export function composerContextForQuote(post: PostDto): ComposerContext {
  return { mode: "quote", simulationId: post.roomId, post };
}

/** The composer dialog's header title (§17.2), one per mode. */
export function composerDialogTitle(context: ComposerContext): string {
  switch (context.mode) {
    case "reply":
      return "返信する";
    case "quote":
      return "引用してリポスト";
    case "new":
      return "投稿する";
  }
}

/**
 * The composer's starting text (§39, §21: characters may reply to each
 * other via `@handle`, and the same courtesy applies to a human replying to
 * another account here). Replying pre-fills the mention like a normal SNS
 * client, but only when replying to someone else — replying to your own post
 * should not mention yourself.
 */
export function initialComposerContent(
  context: ComposerContext,
  currentUserId: string,
): string {
  if (context.mode !== "reply") {
    return "";
  }
  if (context.post.author.id === currentUserId) {
    return "";
  }
  return `@${context.post.author.handle} `;
}
