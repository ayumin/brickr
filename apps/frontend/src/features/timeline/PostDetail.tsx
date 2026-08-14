import { useMemo } from "react";
import type { CharacterDto, PostDto, UserProfileDto } from "@brickr/shared";

import type { ThinkingCharacter } from "../../types";
import { PostCard } from "./PostCard";
import { Timeline } from "./Timeline";
import {
  indexPostsById,
  selectSeparateDetailReferenceId,
} from "./thread-utils";

export type PostDetailProps = {
  simulationId: string;
  post: PostDto;
  allPosts: PostDto[];
  characters: CharacterDto[];
  userProfile: UserProfileDto;
  thinking: ThinkingCharacter[];
  canPost: boolean;
  onOpenAuthor: (authorId: string) => void;
  onOpenPost: (postId: string) => void;
  onPosted: (post: PostDto) => void;
};

export function PostDetail({
  simulationId,
  post,
  allPosts,
  characters,
  userProfile,
  thinking,
  canPost,
  onOpenAuthor,
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
        simulationId={simulationId}
        rootPosts={[post]}
        allPosts={allPosts}
        characters={characters}
        userProfile={userProfile}
        thinking={thinking}
        loading={false}
        canPost={canPost}
        emptyTitle="投稿が見つかりません"
        emptyBody="この投稿は表示できません。"
        onOpenAuthor={onOpenAuthor}
        onOpenPost={onOpenPost}
        onPosted={onPosted}
        initialExpandedPostId={post.id}
        rootPostShowQuotedPost={post.replyTo === null}
        rootPostExpandable={false}
      />
    </section>
  );
}
