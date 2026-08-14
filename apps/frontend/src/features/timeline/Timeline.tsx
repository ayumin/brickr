import { useEffect, useMemo, useState } from "react";
import type { CharacterDto, PostDto, UserProfileDto } from "@brickr/shared";

import { Avatar } from "../../components/Avatar";
import { Icon } from "../../components/Icon";
import { Spinner } from "../../components/Spinner";
import type { ResponseActivity } from "../../types";
import { Composer } from "../composer/Composer";
import { PostCard } from "./PostCard";
import { PostContent } from "./PostContent";
import { formatRelativeTime } from "./QuotePost";
import {
  buildReplyIndex,
  buildRepostIndex,
  countReplies,
  countReposts,
  flattenReplies,
  indexPostsById,
  selectReposts,
} from "./thread-utils";

type InlineComposerState = {
  postId: string;
  mode: "reply" | "quote";
};

const TIMELINE_PAGE_SIZE = 100;

function toggleId(
  current: ReadonlySet<string>,
  id: string,
): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

/**
 * The anonymous "a response is coming" row (§11.2, §16.1).
 *
 * No avatar, name or handle: the stream does not say who is generating, and
 * inventing a placeholder identity here would be the very hint the feed hides.
 * Several responses to the same post collapse into one row with a count.
 */
function ResponseActivityRow({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-line bg-surface px-6 py-2.5">
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-raised"
        aria-hidden="true"
      >
        <span className="h-2 w-2 rounded-full bg-ink-faint" />
      </span>
      <p className="flex items-center gap-1 text-sm text-ink-muted">
        {count > 1 ? `応答を生成中（${String(count)}件）` : "応答を生成中"}
        <span className="flex items-center gap-0.5" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="brickr-dot inline-block h-1 w-1 rounded-full bg-ink-muted"
              style={{ animationDelay: `${String(index * 150)}ms` }}
            />
          ))}
        </span>
      </p>
    </div>
  );
}

/**
 * One repost, rendered lighter than a full post card.
 * Intentionally has no expanders and no composer, so the UI cannot recurse.
 */
function RepostRow({
  repost,
  onOpenAuthor,
  onOpenPost,
}: {
  repost: PostDto;
  onOpenAuthor?: (authorId: string) => void;
  onOpenPost?: (postId: string) => void;
}) {
  const author = repost.author;
  return (
    <li className="flex gap-2.5 px-4 py-2.5">
      <button
        type="button"
        onClick={
          onOpenAuthor
            ? () => {
                onOpenAuthor(author.id);
              }
            : undefined
        }
        disabled={!onOpenAuthor}
        className="mt-0.5 shrink-0 rounded-full disabled:cursor-default"
        aria-label={`${author.displayName} のタイムライン`}
      >
        <Avatar
          handle={author.handle}
          displayName={author.displayName}
          avatarUrl={author.avatarUrl}
          size="sm"
        />
      </button>

      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[13px]">
          <button
            type="button"
            onClick={
              onOpenAuthor
                ? () => {
                    onOpenAuthor(author.id);
                  }
                : undefined
            }
            disabled={!onOpenAuthor}
            className="flex min-w-0 items-center gap-x-1.5 rounded text-left disabled:cursor-default enabled:hover:underline"
          >
            <span className="truncate font-semibold text-ink">
              {author.displayName}
            </span>
            <span className="truncate text-ink-faint">@{author.handle}</span>
          </button>
          <span className="text-ink-faint">·</span>
          <time dateTime={repost.createdAt} className="text-ink-faint">
            {formatRelativeTime(repost.createdAt)}
          </time>
        </p>
        <p className="mt-0.5 text-[14px] break-words whitespace-pre-wrap text-ink-muted">
          <PostContent content={repost.content} />
        </p>
      </div>
      {onOpenPost ? (
        <button
          type="button"
          onClick={() => onOpenPost(repost.id)}
          aria-label="このリポストを展開"
          title="投稿を展開"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-faint hover:bg-surface-raised hover:text-accent"
        >
          <Icon name="arrows-angle-expand" />
        </button>
      ) : null}
    </li>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-6 py-16 text-center">
      <p className="text-2xl text-ink-faint">
        <Icon name="chat-dots" />
      </p>
      <p className="mt-3 font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-2 max-w-sm text-sm whitespace-pre-line text-ink-muted">
        {body}
      </p>
    </div>
  );
}

export type TimelineProps = {
  simulationId: string;
  /** Posts to show at the top level, already ordered by the caller. */
  rootPosts: PostDto[];
  /** Every post in the simulation, used to derive threads and reposts. */
  allPosts: PostDto[];
  characters: CharacterDto[];
  userProfile: UserProfileDto;
  activities: ResponseActivity[];
  loading: boolean;
  emptyTitle: string;
  emptyBody: string;
  /** False when the simulation is stopped: no reply / repost composers. */
  canPost: boolean;
  onOpenAuthor: (authorId: string) => void;
  onPosted: (post: PostDto) => void;
  onOpenPost: (postId: string) => void;
  /** Detail view starts with this post's replies and reposts open. */
  initialExpandedPostId?: string;
  rootPostShowQuotedPost?: boolean;
  /**
   * False in the post detail view: the root post is already the focus of the
   * page, so its header expand icon is redundant and would sit uncomfortably
   * close to the expand icon on any embedded quoted post.
   */
  rootPostExpandable?: boolean;
};

export function Timeline({
  simulationId,
  rootPosts,
  allPosts,
  characters,
  userProfile,
  activities,
  loading,
  emptyTitle,
  emptyBody,
  canPost,
  onOpenAuthor,
  onPosted,
  onOpenPost,
  initialExpandedPostId,
  rootPostShowQuotedPost = true,
  rootPostExpandable = true,
}: TimelineProps) {
  const [expandedReplies, setExpandedReplies] = useState<ReadonlySet<string>>(
    () => new Set(initialExpandedPostId ? [initialExpandedPostId] : []),
  );
  const [expandedReposts, setExpandedReposts] = useState<ReadonlySet<string>>(
    () => new Set(initialExpandedPostId ? [initialExpandedPostId] : []),
  );
  const [inlineComposer, setInlineComposer] =
    useState<InlineComposerState | null>(null);
  const [visibleCount, setVisibleCount] = useState(TIMELINE_PAGE_SIZE);

  const visibleRootPosts = useMemo(
    () => rootPosts.slice(0, visibleCount),
    [rootPosts, visibleCount],
  );

  const replyIndex = useMemo(() => buildReplyIndex(allPosts), [allPosts]);
  const repostIndex = useMemo(() => buildRepostIndex(allPosts), [allPosts]);
  const postsById = useMemo(() => indexPostsById(allPosts), [allPosts]);

  const activityCountByTarget = useMemo(() => {
    const index = new Map<string, number>();
    for (const activity of activities) {
      index.set(activity.targetPostId, (index.get(activity.targetPostId) ?? 0) + 1);
    }
    return index;
  }, [activities]);

  // A cascade may start while its target is inside a collapsed reply thread.
  // Reveal that thread so the indicator can stay directly below its target.
  useEffect(() => {
    if (activities.length === 0) return;
    const visibleRoots = new Set(visibleRootPosts.map((post) => post.id));
    const rootsToExpand = new Set<string>();

    for (const activity of activities) {
      let post = postsById.get(activity.targetPostId);
      const visited = new Set<string>();
      while (post?.replyTo && !visited.has(post.id)) {
        visited.add(post.id);
        post = postsById.get(post.replyTo);
      }
      if (post && visibleRoots.has(post.id) && post.id !== activity.targetPostId) {
        rootsToExpand.add(post.id);
      }
    }

    if (rootsToExpand.size === 0) return;
    setExpandedReplies((current) => {
      const next = new Set(current);
      let changed = false;
      for (const id of rootsToExpand) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [thinking, postsById, visibleRootPosts]);

  const knownHandles = useMemo(() => {
    const handles = new Set<string>([userProfile.handle]);
    for (const character of characters) {
      handles.add(character.handle);
    }
    return handles;
  }, [characters, userProfile.handle]);

  const authorIdByHandle = useMemo(() => {
    const map = new Map<string, string>([[userProfile.handle, userProfile.id]]);
    for (const character of characters) {
      map.set(character.handle, character.id);
    }
    return map;
  }, [characters, userProfile.handle, userProfile.id]);

  const openHandle = (handle: string): void => {
    const authorId = authorIdByHandle.get(handle);
    if (authorId) {
      onOpenAuthor(authorId);
    }
  };

  const replyToHandleOf = (post: PostDto): string | null =>
    post.replyTo ? (postsById.get(post.replyTo)?.author.handle ?? null) : null;

  /** Reply and repost expansion are independent toggles. */
  const toggleReplies = (postId: string): void => {
    setExpandedReplies((current) => toggleId(current, postId));
  };
  const toggleReposts = (postId: string): void => {
    setExpandedReposts((current) => toggleId(current, postId));
  };

  const openInlineComposer = (
    postId: string,
    mode: "reply" | "quote",
  ): void => {
    // Only one inline composer is open at a time.
    setInlineComposer((current) =>
      current && current.postId === postId && current.mode === mode
        ? null
        : { postId, mode },
    );
  };

  const closeInlineComposer = (): void => {
    setInlineComposer(null);
  };

  /**
   * After an inline post, reveal it: a reply lands inside the target's thread
   * and a repost inside the target's repost list, both of which may be closed.
   */
  const handleInlinePosted = (post: PostDto): void => {
    onPosted(post);
    const repliedTo = post.replyTo;
    if (repliedTo !== null) {
      setExpandedReplies((current) => new Set(current).add(repliedTo));
    }
    const quoted = post.quoteOf;
    if (quoted !== null) {
      setExpandedReposts((current) => new Set(current).add(quoted));
    }
  };

  const renderInlineComposer = (post: PostDto) => {
    if (!canPost || inlineComposer?.postId !== post.id) {
      return null;
    }
    return (
      <Composer
        simulationId={simulationId}
        characters={characters}
        userProfile={userProfile}
        compact
        autoFocus
        scope={{ mode: inlineComposer.mode, post }}
        onOpenUser={() => onOpenAuthor(userProfile.id)}
        onCancel={closeInlineComposer}
        onPosted={handleInlinePosted}
      />
    );
  };

  const renderThinking = (postId: string) => {
    const charactersForPost = thinkingByTarget.get(postId) ?? [];
    if (charactersForPost.length === 0) return null;
    return (
      <div aria-label="この投稿への応答を考えているキャラクター">
        {charactersForPost.map((character) => (
          <ThinkingRow
            key={`${character.characterId}:${character.targetPostId}`}
            character={character}
          />
        ))}
      </div>
    );
  };

  const renderRepostList = (post: PostDto) => {
    if (!expandedReposts.has(post.id)) {
      return null;
    }
    const reposts = selectReposts(repostIndex, post.id);
    if (reposts.length === 0) {
      return null;
    }
    return (
      <div className="border-b border-line bg-surface">
        <p className="px-4 pt-2 text-[11px] font-medium text-ink-faint">
          リポストしたキャラクター
        </p>
        <ul>
          {reposts.map((repost) => (
            <RepostRow
              key={repost.id}
              repost={repost}
              onOpenAuthor={onOpenAuthor}
              onOpenPost={onOpenPost}
            />
          ))}
        </ul>
      </div>
    );
  };

  if (loading && allPosts.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Spinner label="タイムラインを読み込み中…" />
      </div>
    );
  }

  return (
    <div>
      <ul>
        {/*
          Newest first at the top level (home = your own threads, author
          timelines = that author's posts). Inside an expanded thread the
          replies stay oldest-first, because a conversation reads chronologically.
        */}
        {rootPosts.length === 0 ? (
          <li>
            <EmptyState title={emptyTitle} body={emptyBody} />
          </li>
        ) : null}

        {visibleRootPosts.map((post) => {
          const replyCount = countReplies(replyIndex, post.id);
          const repostCount = countReposts(repostIndex, post.id);
          const repliesExpanded = expandedReplies.has(post.id);

          return (
            <li key={post.id}>
              <PostCard
                post={post}
                currentUserId={userProfile.id}
                replyToHandle={replyToHandleOf(post)}
                knownHandles={knownHandles}
                onOpenAuthor={onOpenAuthor}
                onOpenHandle={openHandle}
                {...(rootPostExpandable ? { onExpand: onOpenPost } : {})}
                showQuotedPost={rootPostShowQuotedPost}
                replyCount={replyCount}
                repostCount={repostCount}
                repliesExpanded={repliesExpanded}
                repostsExpanded={expandedReposts.has(post.id)}
                onToggleReplies={() => {
                  toggleReplies(post.id);
                }}
                onToggleReposts={() => {
                  toggleReposts(post.id);
                }}
                {...(canPost
                  ? {
                      onReply: () => {
                        openInlineComposer(post.id, "reply");
                      },
                      onRepost: () => {
                        openInlineComposer(post.id, "quote");
                      },
                    }
                  : {})}
              />

              {renderThinking(post.id)}

              {renderInlineComposer(post)}
              {renderRepostList(post)}

              {repliesExpanded ? (
                <div className="border-l-2 border-accent/30 bg-surface">
                  <ul>
                    {/*
                      One flat chronological level: a reply-to-a-reply sits at
                      the same indent, and the 「@handle への返信」 line above
                      each row carries the relationship.
                    */}
                    {flattenReplies(replyIndex, post.id).map((reply) => (
                      <li key={reply.id}>
                        <PostCard
                          post={reply}
                          currentUserId={userProfile.id}
                          dense
                          replyToHandle={replyToHandleOf(reply)}
                          knownHandles={knownHandles}
                          onOpenAuthor={onOpenAuthor}
                          onOpenHandle={openHandle}
                          onExpand={onOpenPost}
                          // No nested reply expander: every descendant is
                          // already visible in this flat list.
                          replyCount={countReplies(replyIndex, reply.id)}
                          repostCount={countReposts(repostIndex, reply.id)}
                          repostsExpanded={expandedReposts.has(reply.id)}
                          onToggleReposts={() => {
                            toggleReposts(reply.id);
                          }}
                          {...(canPost
                            ? {
                                onReply: () => {
                                  openInlineComposer(reply.id, "reply");
                                },
                                onRepost: () => {
                                  openInlineComposer(reply.id, "quote");
                                },
                              }
                            : {})}
                        />
                        {renderThinking(reply.id)}
                        {renderInlineComposer(reply)}
                        {renderRepostList(reply)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {visibleRootPosts.length < rootPosts.length ? (
        <div className="border-b border-line px-4 py-4 text-center">
          <button
            type="button"
            onClick={() =>
              setVisibleCount((current) => current + TIMELINE_PAGE_SIZE)
            }
            className="rounded-full border border-line px-5 py-2 text-sm font-semibold text-accent transition hover:bg-accent/10"
          >
            さらに表示
          </button>
          <p className="mt-1.5 text-xs text-ink-faint">
            {visibleRootPosts.length} / {rootPosts.length}件を表示
          </p>
        </div>
      ) : null}
    </div>
  );
}
