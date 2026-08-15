import { useMemo } from "react";
import type { FeedThreadDto, PostDto, UserProfileDto } from "@brickr/shared";

import type { ResponseActivity } from "../../types";
import { PostCard } from "./PostCard";
import { Timeline } from "./Timeline";
import {
  indexPostsById,
  selectSeparateDetailReferenceId,
} from "./thread-utils";

export type PostDetailProps = {
  post: PostDto;
  allPosts: PostDto[];
  userProfile: UserProfileDto;
  activities: ResponseActivity[];
  canPost: boolean;
  onOpenAuthor: (authorId: string) => void;
  onOpenHandle: (handle: string) => void;
  onOpenPost: (postId: string) => void;
  onPosted: (post: PostDto, thread: FeedThreadDto) => void;
};

export function PostDetail({
  post,
  allPosts,
  userProfile,
  activities,
  canPost,
  onOpenAuthor,
  onOpenHandle,
  onOpenPost,
  onPosted,
}: PostDetailProps) {
  const postsById = useMemo(() => indexPostsById(allPosts), [allPosts]);

  const separateReferenceId = selectSeparateDetailReferenceId(post);
  const separateReference = separateReferenceId
    ? postsById.get(separateReferenceId)
    : undefined;

  return (
    <section>
      {separateReference ? (
        <div className="border-b border-line bg-surface">
          <p className="px-4 pt-3 text-xs font-semibold text-ink-faint">
            この投稿が参照している投稿
          </p>
          <PostCard
            post={separateReference}
            currentUserId={userProfile.id}
            dense
            showQuotedPost={false}
            onOpenAuthor={onOpenAuthor}
            onExpand={onOpenPost}
          />
        </div>
      ) : null}

      <Timeline
        key={post.id}
        rootPosts={[post]}
        allPosts={allPosts}
        userProfile={userProfile}
        activities={activities}
        loading={false}
        canPost={canPost}
        emptyTitle="投稿が見つかりません"
        emptyBody="この投稿は表示できません。"
        onOpenAuthor={onOpenAuthor}
        onOpenHandle={onOpenHandle}
        onOpenPost={onOpenPost}
        onPosted={onPosted}
        initialExpandedPostId={post.id}
        rootPostShowQuotedPost={post.replyTo === null}
        rootPostExpandable={false}
      />
    </section>
  );
}
