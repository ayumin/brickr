import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedThreadDto, PostDto } from "@brickr/shared";

import { ErrorBanner } from "../../components/ErrorBanner";
import { Icon } from "../../components/Icon";
import { Spinner } from "../../components/Spinner";
import { PostCard } from "../timeline/PostCard";
import { api, isAbortError, toErrorMessage } from "../../services/api-client";
import { resolveReplyDisplay, selectFeedReplyOverflowCount, selectFeedReplyPreview } from "../timeline/thread-utils";
import type { FeedThreadActions } from "./feed-actions";

export type ReplyPreviewProps = {
  thread: FeedThreadDto;
  currentUserId?: string;
  /** Handles we recognise (characters + the user), for mention highlighting. */
  knownHandles?: ReadonlySet<string>;
  onOpenAuthor?: (authorId: string) => void;
  onOpenHandle?: (handle: string) => void;
  onOpenThread?: (postId: string) => void;
  /** Computed by the parent `FeedThreadCard` via `selectFeedThreadActions`. */
  actions: FeedThreadActions;
};

type Expansion =
  | { status: "collapsed" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "expanded"; posts: PostDto[] };

/**
 * Up to two newest replies, oldest→newest (§12.2) - or, once "残りN件を表示"
 * is used, every reply in the thread (`GET /api/posts/:threadRootId/replies`,
 * §12.2).
 *
 * Selection and ordering of the two-reply preview are already done
 * server-side (`thread.latestReplies`); a full expansion is likewise already
 * ordered oldest-first by the backend. Either way this renders a flat list: a
 * reply-to-a-reply sits at the same indent as a direct reply, with `→
 * @handle` (via `PostCard`'s `replyToHandle`, resolved by
 * `resolveReplyDisplay`) as the only signal of who it answers.
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
  actions,
}: ReplyPreviewProps) {
  const [expansion, setExpansion] = useState<Expansion>({ status: "collapsed" });
  const abortRef = useRef<AbortController | null>(null);

  // Aborts an expansion request left in flight when this card leaves the
  // list entirely (e.g. a filter change). React remounts this component
  // whenever `thread.root.id` changes, since callers always key by it, so
  // there is no need to reset `expansion` on that change here.
  useEffect(() => () => abortRef.current?.abort(), []);

  const loadAllReplies = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setExpansion({ status: "loading" });
    api
      .getThreadReplies(thread.root.id, controller.signal)
      .then((posts) => setExpansion({ status: "expanded", posts }))
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return;
        setExpansion({ status: "error", message: toErrorMessage(cause) });
      });
  }, [thread.root.id]);

  if (thread.replyCount === 0) {
    return null;
  }

  const preview =
    expansion.status === "expanded"
      ? resolveReplyDisplay(thread.root, expansion.posts)
      : selectFeedReplyPreview(thread);
  const overflow = selectFeedReplyOverflowCount(thread);

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

      {expansion.status === "collapsed" && actions.showMoreReplies && overflow > 0 ? (
        <button
          type="button"
          onClick={loadAllReplies}
          className="flex w-full items-center gap-1 px-4 py-2 text-left text-xs font-medium text-accent transition hover:bg-accent/10"
        >
          残り{overflow}件を表示
          <Icon name="chevron-right" />
        </button>
      ) : expansion.status === "loading" ? (
        <div className="flex justify-center py-2">
          <Spinner size="sm" />
        </div>
      ) : expansion.status === "error" ? (
        <div className="px-4 py-2">
          <ErrorBanner message="返信を取得できませんでした" detail={expansion.message} onRetry={loadAllReplies} />
        </div>
      ) : null}
    </div>
  );
}
