import type { FeedThreadDto } from "@brickr/shared";

import { Icon } from "../../components/Icon";
import { PostCard } from "../timeline/PostCard";
import { selectFeedReplyOverflowCount, selectFeedReplyPreview } from "../timeline/thread-utils";

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
 */
export function ReplyPreview({
  thread,
  currentUserId,
  knownHandles,
  onOpenAuthor,
  onOpenHandle,
  onOpenThread,
  onShowMoreReplies,
}: ReplyPreviewProps) {
  const preview = selectFeedReplyPreview(thread);
  const overflow = selectFeedReplyOverflowCount(thread);

  // Anonymous readers get every capability as `false` (§10.1), including
  // `canOpenAuthor` — profile/thread navigation always requires a session,
  // regardless of this thread's own room being stopped or not.
  const canOpenAuthor = thread.capabilities.canOpenAuthor;

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
          {...(canOpenAuthor && onOpenAuthor ? { onOpenAuthor } : {})}
          {...(canOpenAuthor && onOpenHandle ? { onOpenHandle } : {})}
          {...(thread.capabilities.canOpenThread && onOpenThread ? { onExpand: onOpenThread } : {})}
        />
      ))}

      {thread.capabilities.canLoadMoreReplies && overflow > 0 && onShowMoreReplies ? (
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
