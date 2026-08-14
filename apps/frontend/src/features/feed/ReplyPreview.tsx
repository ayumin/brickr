import type { FeedThreadDto } from "@brickr/shared";

import { Icon } from "../../components/Icon";
import { PostCard } from "../timeline/PostCard";
import { selectFeedReplyOverflowCount, selectFeedReplyPreview } from "../timeline/thread-utils";
import { selectFeedThreadActions, type FeedThreadActions } from "./feed-actions";

export type ReplyPreviewProps = {
  thread: FeedThreadDto;
  currentUserId?: string;
  /** Handles we recognise (characters + the user), for mention highlighting. */
  knownHandles?: ReadonlySet<string>;
  onOpenAuthor?: (authorId: string) => void;
  onOpenHandle?: (handle: string) => void;
  onOpenThread?: (postId: string) => void;
  /** Fired with the thread's root id when there are more replies than shown here. */
  onShowMoreReplies?: (threadRootId: string) => void;
  /**
   * Pre-computed actions from the parent `FeedThreadCard`. When absent the
   * component derives them itself so `ReplyPreview` can still be used
   * standalone (e.g. in tests or future contexts).
   */
  actions?: FeedThreadActions;
};

/**
 * Up to two newest replies, oldest→newest (§12.2).
 *
 * Selection and ordering are already done server-side (`thread.latestReplies`
 * — see `selectFeedReplyPreview`), so this renders a flat list: a
 * reply-to-a-reply sits at the same indent as a direct reply, with `→
 * @handle` (via `PostCard`'s `replyToHandle`) as the only signal of who it
 * answers.
 *
 * Fetching the rest is Step 7-4's job (`GET /api/posts/:threadRootId/replies`)
 * — `onShowMoreReplies` only reports the intent.
 *
 * Every interactive affordance is gated by `actions` (derived from
 * `capabilities`) — never inferred from a status field or from whether a
 * session exists (§9.3, §16.3, §27).
 */
export function ReplyPreview({
  thread,
  currentUserId,
  knownHandles,
  onOpenAuthor,
  onOpenHandle,
  onOpenThread,
  onShowMoreReplies,
  actions: actionsProp,
}: ReplyPreviewProps) {
  const preview = selectFeedReplyPreview(thread);
  const overflow = selectFeedReplyOverflowCount(thread);

  // Use pre-computed actions when provided by the parent (avoids recomputing
  // the same capabilities mapping twice per render), or derive them here when
  // used standalone.
  const actions = actionsProp ?? selectFeedThreadActions(thread.capabilities);

  if (preview.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-line/60">
      {preview.map(({ post, replyToHandle }) => (
        <PostCard
          key={post.id}
          post={post}
          dense
          currentUserId={currentUserId}
          replyToHandle={replyToHandle}
          {...(knownHandles ? { knownHandles } : {})}
          {...(actions.replies.canOpenAuthor && onOpenAuthor ? { onOpenAuthor } : {})}
          {...(actions.replies.canOpenAuthor && onOpenHandle ? { onOpenHandle } : {})}
          {...(actions.replies.canOpenThread && onOpenThread ? { onExpand: onOpenThread } : {})}
        />
      ))}

      {actions.showMoreReplies && overflow > 0 && onShowMoreReplies ? (
        <button
          type="button"
          onClick={() => onShowMoreReplies(thread.root.id)}
          className="flex w-full items-center gap-1 px-4 py-2 text-left text-xs font-medium text-accent transition hover:bg-accent/10"
        >
          残り{overflow}件を表示
          <Icon name="chevron-right" />
        </button>
      ) : null}
    </div>
  );
}
