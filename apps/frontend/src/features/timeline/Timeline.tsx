import { useMemo, useState } from "react";
import { USER_AUTHOR_ID, USER_HANDLE } from "@enjo/shared";
import type { CharacterDto, PostDto } from "@enjo/shared";

import { Avatar } from "../../components/Avatar";
import { Spinner } from "../../components/Spinner";
import type { ThinkingCharacter } from "../../types";
import { Composer } from "../composer/Composer";
import { PostCard } from "./PostCard";
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

function ThinkingRow({ character }: { character: ThinkingCharacter }) {
  return (
    <li className="flex items-center gap-3 border-b border-line px-4 py-3">
      <Avatar
        handle={character.handle}
        displayName={character.displayName}
        size="md"
      />
      <div className="min-w-0">
        <p className="truncate text-sm text-ink">
          <span className="font-semibold">{character.displayName}</span>
          <span className="text-ink-faint"> @{character.handle}</span>
        </p>
        <p className="flex items-center gap-1 text-sm text-ink-muted">
          考え中
          <span className="flex items-center gap-0.5" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <span
                key={index}
                className="enjo-dot inline-block h-1 w-1 rounded-full bg-ink-muted"
                style={{ animationDelay: `${String(index * 150)}ms` }}
              />
            ))}
          </span>
        </p>
      </div>
    </li>
  );
}

/**
 * One repost, rendered lighter than a full post card.
 * Intentionally has no expanders and no composer, so the UI cannot recurse.
 */
function RepostRow({
  repost,
  onOpenAuthor,
}: {
  repost: PostDto;
  onOpenAuthor?: (authorId: string) => void;
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
          {repost.content}
        </p>
      </div>
    </li>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-6 py-16 text-center">
      <p className="text-2xl" aria-hidden="true">
        🔥
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
  thinking: ThinkingCharacter[];
  loading: boolean;
  emptyTitle: string;
  emptyBody: string;
  /** False when the simulation is stopped: no reply / repost composers. */
  canPost: boolean;
  onOpenAuthor: (authorId: string) => void;
  onPosted: (post: PostDto) => void;
};

export function Timeline({
  simulationId,
  rootPosts,
  allPosts,
  characters,
  thinking,
  loading,
  emptyTitle,
  emptyBody,
  canPost,
  onOpenAuthor,
  onPosted,
}: TimelineProps) {
  const [expandedReplies, setExpandedReplies] = useState<ReadonlySet<string>>(
    new Set<string>(),
  );
  const [expandedReposts, setExpandedReposts] = useState<ReadonlySet<string>>(
    new Set<string>(),
  );
  const [inlineComposer, setInlineComposer] =
    useState<InlineComposerState | null>(null);

  const replyIndex = useMemo(() => buildReplyIndex(allPosts), [allPosts]);
  const repostIndex = useMemo(() => buildRepostIndex(allPosts), [allPosts]);
  const postsById = useMemo(() => indexPostsById(allPosts), [allPosts]);

  const knownHandles = useMemo(() => {
    const handles = new Set<string>([USER_HANDLE]);
    for (const character of characters) {
      handles.add(character.handle);
    }
    return handles;
  }, [characters]);

  const authorIdByHandle = useMemo(() => {
    const map = new Map<string, string>([[USER_HANDLE, USER_AUTHOR_ID]]);
    for (const character of characters) {
      map.set(character.handle, character.id);
    }
    return map;
  }, [characters]);

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
        compact
        autoFocus
        scope={{ mode: inlineComposer.mode, post }}
        onCancel={closeInlineComposer}
        onPosted={handleInlinePosted}
      />
    );
  };

  const renderRepostList = (post: PostDto) => {
    if (!expandedReposts.has(post.id)) {
      return null;
    }
    const reposts = selectReposts(repostIndex, post.id);
    return (
      <div className="border-b border-line bg-black/25">
        <p className="px-4 pt-2 text-[11px] font-medium text-ink-faint">
          リポストしたキャラクター
        </p>
        <ul>
          {reposts.map((repost) => (
            <RepostRow
              key={repost.id}
              repost={repost}
              onOpenAuthor={onOpenAuthor}
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
        {thinking.map((character) => (
          <ThinkingRow key={character.characterId} character={character} />
        ))}

        {rootPosts.length === 0 && thinking.length === 0 ? (
          <li>
            <EmptyState title={emptyTitle} body={emptyBody} />
          </li>
        ) : null}

        {rootPosts.map((post) => {
          const replyCount = countReplies(replyIndex, post.id);
          const repostCount = countReposts(repostIndex, post.id);
          const repliesExpanded = expandedReplies.has(post.id);

          return (
            <li key={post.id}>
              <PostCard
                post={post}
                replyToHandle={replyToHandleOf(post)}
                knownHandles={knownHandles}
                onOpenAuthor={onOpenAuthor}
                onOpenHandle={openHandle}
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

              {renderInlineComposer(post)}
              {renderRepostList(post)}

              {repliesExpanded ? (
                <div className="border-l-2 border-accent/30 bg-black/20">
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
                          dense
                          replyToHandle={replyToHandleOf(reply)}
                          knownHandles={knownHandles}
                          onOpenAuthor={onOpenAuthor}
                          onOpenHandle={openHandle}
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
    </div>
  );
}
