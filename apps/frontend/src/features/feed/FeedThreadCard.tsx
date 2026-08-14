import { Link } from "react-router-dom";
import type { FeedThreadDto, PostDto } from "@brickr/shared";

import { PostCard } from "../timeline/PostCard";
import { roomPath } from "../../routes";
import { ReplyPreview } from "./ReplyPreview";
import { selectFeedThreadActions } from "./feed-actions";

export type FeedThreadCardProps = {
  thread: FeedThreadDto;
  currentUserId?: string;
  /** Handles we recognise (characters + the user), for mention highlighting. */
  knownHandles?: ReadonlySet<string>;
  onOpenAuthor?: (authorId: string) => void;
  onOpenHandle?: (handle: string) => void;
  onOpenThread?: (postId: string) => void;
  onReply?: (post: PostDto) => void;
  onRepost?: (post: PostDto) => void;
  /** Fired with the thread's root id when there are more replies than shown here. */
  onShowMoreReplies?: (threadRootId: string) => void;
};

/**
 * One thread as the unified feed shows it (§16.2): the root post, its room
 * label, and up to two preview replies. Every interactive affordance is
 * gated by the thread's own `capabilities` — never inferred from a status
 * field or from whether a session exists (§9.3, §16.3): a stopped room's
 * thread still renders normally here, it just arrives with every capability
 * turned off.
 *
 * `data-thread-id` is read by the scroll-anchor logic Step 7-3 adds — not
 * used here, but the root element every thread needs it on is this one.
 */
export function FeedThreadCard({
  thread,
  currentUserId,
  knownHandles,
  onOpenAuthor,
  onOpenHandle,
  onOpenThread,
  onReply,
  onRepost,
  onShowMoreReplies,
}: FeedThreadCardProps) {
  const { root, room } = thread;
  const actions = selectFeedThreadActions(thread.capabilities);

  return (
    <div data-thread-id={root.id}>
      <div className="px-4 pt-2.5 text-xs text-ink-faint">
        {actions.root.canOpenRoom ? (
          <Link to={roomPath(root.simulationId)} className="hover:underline">
            {room.title}
          </Link>
        ) : (
          <span>{room.title}</span>
        )}
      </div>

      <PostCard
        post={root}
        currentUserId={currentUserId}
        replyCount={thread.replyCount}
        {...(knownHandles ? { knownHandles } : {})}
        {...(actions.root.canOpenAuthor && onOpenAuthor ? { onOpenAuthor } : {})}
        {...(actions.root.canOpenAuthor && onOpenHandle ? { onOpenHandle } : {})}
        {...(actions.root.canOpenThread && onOpenThread ? { onExpand: onOpenThread } : {})}
        {...(actions.root.canReply && onReply ? { onReply: () => onReply(root) } : {})}
        {...(actions.root.canQuote && onRepost ? { onRepost: () => onRepost(root) } : {})}
      />

      <ReplyPreview
        thread={thread}
        currentUserId={currentUserId}
        actions={actions}
        {...(knownHandles ? { knownHandles } : {})}
        {...(onOpenAuthor ? { onOpenAuthor } : {})}
        {...(onOpenHandle ? { onOpenHandle } : {})}
        {...(onOpenThread ? { onOpenThread } : {})}
        {...(onShowMoreReplies ? { onShowMoreReplies } : {})}
      />
    </div>
  );
}
