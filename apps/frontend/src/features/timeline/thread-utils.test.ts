import { describe, expect, it } from "vitest";
import type { FeedThreadDto, PostAuthorDto, PostDto } from "@brickr/shared";

import {
  buildReplyIndex,
  buildRepostIndex,
  countReplies,
  countReposts,
  flattenReplies,
  resolveReplyDisplay,
  selectAuthorTimeline,
  selectFeedReplyOverflowCount,
  selectFeedReplyPreview,
  selectSeparateDetailReferenceId,
  selectReposts,
  selectUserTimeline,
} from "./thread-utils";

// `selectUserTimeline`/`selectAuthorTimeline` take the signed-in user's
// id/handle as parameters, so these fixtures use their own identity: a test must
// not pass by matching some shared constant instead of the argument under test.
const TEST_USER_ID = "test-user-id";
const TEST_USER_HANDLE = "testuser";

// Both fixtures are the same shape on purpose: a public post says nothing about
// whether its author is a person or a character (§9.1).
const userAuthor: PostAuthorDto = {
  id: TEST_USER_ID,
  handle: TEST_USER_HANDLE,
  displayName: "あなた",
};

function characterAuthor(id: string): PostAuthorDto {
  return { id, handle: id, displayName: id.toUpperCase() };
}

type PostOverrides = {
  author?: PostAuthorDto;
  content?: string;
  replyTo?: string | null;
  quoteOf?: string | null;
  quoted?: boolean;
  mentions?: string[];
};

/** Minute-resolution timestamps keep the fixtures readable. */
function makePost(
  id: string,
  minute: number,
  overrides: PostOverrides = {},
): PostDto {
  const author = overrides.author ?? characterAuthor("architect");
  const quoteOf = overrides.quoteOf ?? null;
  return {
    id,
    roomId: "sim_1",
    author,
    content: overrides.content ?? `post ${id}`,
    mentions: overrides.mentions ?? [],
    replyTo: overrides.replyTo ?? null,
    quoteOf,
    quotedPost:
      quoteOf === null
        ? null
        : {
            id: quoteOf,
            author: userAuthor,
            content: "quoted body",
            createdAt: "2026-08-10T10:00:00.000Z",
          },
    createdAt: `2026-08-10T10:${String(minute).padStart(2, "0")}:00.000Z`,
  };
}

const ids = (posts: readonly PostDto[]): string[] =>
  posts.map((post) => post.id);

describe("countReplies", () => {
  it("counts descendants transitively across three levels", () => {
    const posts = [
      makePost("root", 0, { author: userAuthor }),
      makePost("a", 1, { replyTo: "root" }),
      makePost("b", 2, { replyTo: "a" }),
      makePost("c", 3, { replyTo: "b" }),
      makePost("d", 4, { replyTo: "root" }),
    ];
    const index = buildReplyIndex(posts);

    expect(countReplies(index, "root")).toBe(4);
    expect(countReplies(index, "a")).toBe(2);
    expect(countReplies(index, "b")).toBe(1);
  });

  it("returns 0 for a post with no replies", () => {
    const posts = [makePost("lonely", 0, { author: userAuthor })];
    expect(countReplies(buildReplyIndex(posts), "lonely")).toBe(0);
    // Unknown ids are safe too.
    expect(countReplies(buildReplyIndex(posts), "missing")).toBe(0);
  });

  it("excludes reposts (quote posts) from the reply count", () => {
    const posts = [
      makePost("root", 0, { author: userAuthor }),
      makePost("reply", 1, { replyTo: "root" }),
      // A repost of the root: quoteOf only, so it is not a reply.
      makePost("repost", 2, { author: characterAuthor("kansai"), quoteOf: "root" }),
    ];
    const index = buildReplyIndex(posts);

    expect(countReplies(index, "root")).toBe(1);
    expect(ids(flattenReplies(index, "root"))).toEqual(["reply"]);
  });

  it("treats a quote that also targets a parent as a reply (documented choice)", () => {
    const posts = [
      makePost("root", 0, { author: userAuthor }),
      makePost("both", 1, { replyTo: "root", quoteOf: "root" }),
    ];
    const index = buildReplyIndex(posts);

    // replyTo wins so the count keeps matching what the expander reveals.
    expect(countReplies(index, "root")).toBe(1);
  });

  it("matches the length of the flat expansion", () => {
    const posts = [
      makePost("root", 0, { author: userAuthor }),
      makePost("a", 1, { replyTo: "root" }),
      makePost("b", 2, { replyTo: "a" }),
    ];
    const index = buildReplyIndex(posts);

    expect(countReplies(index, "root")).toBe(flattenReplies(index, "root").length);
  });
});

describe("flattenReplies", () => {
  it("returns one flat level ordered chronologically, not by depth", () => {
    const posts = [
      makePost("root", 0, { author: userAuthor }),
      // A deep reply created early must still come before a later direct reply.
      makePost("direct-late", 9, { replyTo: "root" }),
      makePost("direct-early", 1, { replyTo: "root" }),
      makePost("nested", 2, { replyTo: "direct-early" }),
      makePost("nested-deep", 3, { replyTo: "nested" }),
    ];
    const index = buildReplyIndex(posts);

    expect(ids(flattenReplies(index, "root"))).toEqual([
      "direct-early",
      "nested",
      "nested-deep",
      "direct-late",
    ]);
  });

  it("does not mutate its inputs", () => {
    const posts = [
      makePost("root", 0, { author: userAuthor }),
      makePost("b", 2, { replyTo: "root" }),
      makePost("a", 1, { replyTo: "root" }),
    ];
    const snapshot = ids(posts);

    const index = buildReplyIndex(posts);
    flattenReplies(index, "root");

    expect(ids(posts)).toEqual(snapshot);
  });

  it("terminates on a replyTo cycle", () => {
    // Corrupt data: x replies to y and y replies to x.
    const posts = [
      makePost("x", 1, { replyTo: "y" }),
      makePost("y", 2, { replyTo: "x" }),
    ];
    const index = buildReplyIndex(posts);

    expect(ids(flattenReplies(index, "x"))).toEqual(["y"]);
    expect(countReplies(index, "x")).toBe(1);
    expect(countReplies(index, "y")).toBe(1);
  });

  it("ignores a post that replies to itself", () => {
    const posts = [makePost("self", 1, { replyTo: "self" })];
    const index = buildReplyIndex(posts);

    expect(flattenReplies(index, "self")).toEqual([]);
    expect(countReplies(index, "self")).toBe(0);
  });
});

describe("reposts", () => {
  it("counts 0 for a post nobody reposted", () => {
    const posts = [
      makePost("root", 0, { author: userAuthor }),
      makePost("reply", 1, { replyTo: "root" }),
    ];
    const index = buildRepostIndex(posts);

    expect(countReposts(index, "root")).toBe(0);
    expect(selectReposts(index, "root")).toEqual([]);
    expect(countReposts(index, "missing")).toBe(0);
  });

  it("returns every reposter in chronological order", () => {
    const posts = [
      makePost("root", 0, { author: userAuthor }),
      makePost("late", 5, {
        author: characterAuthor("kansai"),
        quoteOf: "root",
        content: "後から引用",
      }),
      makePost("early", 2, {
        author: characterAuthor("skeptic"),
        quoteOf: "root",
        content: "先に引用",
      }),
    ];
    const index = buildRepostIndex(posts);

    expect(countReposts(index, "root")).toBe(2);
    expect(ids(selectReposts(index, "root"))).toEqual(["early", "late"]);
  });

  it("attributes a repost to the quoted post, not to that post's parent", () => {
    const posts = [
      makePost("root", 0, { author: userAuthor }),
      makePost("reply", 1, { replyTo: "root" }),
      makePost("repost-of-reply", 2, {
        author: characterAuthor("kansai"),
        quoteOf: "reply",
      }),
    ];
    const index = buildRepostIndex(posts);

    expect(countReposts(index, "reply")).toBe(1);
    expect(countReposts(index, "root")).toBe(0);
  });

  it("counts a reply+repost once in each index without corrupting either", () => {
    // The backend never emits both fields today, but the DTO permits it.
    const posts = [
      makePost("root", 0, { author: userAuthor }),
      makePost("other", 1, { author: userAuthor }),
      makePost("both", 2, {
        author: characterAuthor("skeptic"),
        replyTo: "root",
        quoteOf: "other",
      }),
    ];
    const replyIndex = buildReplyIndex(posts);
    const repostIndex = buildRepostIndex(posts);

    expect(countReplies(replyIndex, "root")).toBe(1);
    expect(countReposts(repostIndex, "other")).toBe(1);
    // And it does not leak into the other relationship.
    expect(countReposts(repostIndex, "root")).toBe(0);
    expect(countReplies(replyIndex, "other")).toBe(0);
  });

  it("ignores a post that quotes itself", () => {
    const posts = [makePost("self", 1, { quoteOf: "self" })];
    expect(countReposts(buildRepostIndex(posts), "self")).toBe(0);
  });
});

describe("selectSeparateDetailReferenceId", () => {
  it("returns the parent for a reply", () => {
    const reply = makePost("reply", 1, { replyTo: "parent" });

    expect(selectSeparateDetailReferenceId(reply)).toBe("parent");
  });

  it("does not duplicate a quote that PostCard embeds", () => {
    const quote = makePost("quote", 1, { quoteOf: "original" });

    expect(selectSeparateDetailReferenceId(quote)).toBeNull();
  });

  it("prefers the reply parent when legacy data contains both references", () => {
    const both = makePost("both", 1, {
      replyTo: "parent",
      quoteOf: "original",
    });

    expect(selectSeparateDetailReferenceId(both)).toBe("parent");
  });

  it("falls back to quoteOf when the embedded quote data is unavailable", () => {
    const quote = {
      ...makePost("quote", 1, { quoteOf: "original" }),
      quotedPost: null,
    };

    expect(selectSeparateDetailReferenceId(quote)).toBe("original");
  });
});

describe("selectUserTimeline", () => {
  it("keeps only user-authored thread starters, newest first", () => {
    const posts = [
      makePost("user-1", 1, { author: userAuthor }),
      makePost("user-reply", 2, { author: userAuthor, replyTo: "user-1" }),
      makePost("character-post", 3),
      makePost("character-reply", 4, { replyTo: "user-1" }),
      makePost("user-2", 5, { author: userAuthor }),
    ];

    expect(ids(selectUserTimeline(posts, TEST_USER_ID, TEST_USER_HANDLE))).toEqual(["user-2", "user-1"]);
  });

  it("keeps a user repost, because it still starts a thread", () => {
    const posts = [
      makePost("user-repost", 2, { author: userAuthor, quoteOf: "character-post" }),
      makePost("character-post", 1),
    ];

    expect(ids(selectUserTimeline(posts, TEST_USER_ID, TEST_USER_HANDLE))).toEqual(["user-repost"]);
  });

  it("includes posts that mention the user, including replies", () => {
    const posts = [
      makePost("root", 1),
      makePost("mentioned-reply", 2, { replyTo: "root", mentions: [TEST_USER_HANDLE] }),
      makePost("not-mentioned", 3, { author: characterAuthor("kansai") }),
    ];

    expect(ids(selectUserTimeline(posts, TEST_USER_ID, TEST_USER_HANDLE))).toEqual(["mentioned-reply"]);
  });

  it("does not duplicate a user thread that also mentions the user", () => {
    const posts = [makePost("self-mention", 1, { author: userAuthor, mentions: [TEST_USER_HANDLE] })];
    expect(ids(selectUserTimeline(posts, TEST_USER_ID, TEST_USER_HANDLE))).toEqual(["self-mention"]);
  });

  it("returns an empty array when the user has neither posted nor been mentioned", () => {
    expect(selectUserTimeline([makePost("only-character", 1)], TEST_USER_ID, TEST_USER_HANDLE)).toEqual([]);
  });
});

describe("selectAuthorTimeline", () => {
  it("includes standalone posts, replies and reposts, newest first", () => {
    const skeptic = characterAuthor("skeptic");
    const posts = [
      makePost("user-root", 0, { author: userAuthor }),
      makePost("standalone", 1, { author: skeptic }),
      makePost("reply", 2, { author: skeptic, replyTo: "user-root" }),
      makePost("repost", 3, { author: skeptic, quoteOf: "user-root" }),
      makePost("other-character", 4, { author: characterAuthor("kansai") }),
    ];

    expect(ids(selectAuthorTimeline(posts, "skeptic", "skeptic"))).toEqual([
      "repost",
      "reply",
      "standalone",
    ]);
  });

  it("includes posts mentioning the character handle", () => {
    const skeptic = characterAuthor("skeptic");
    const posts = [
      makePost("own", 1, { author: skeptic }),
      makePost("mention", 3, {
        author: characterAuthor("kansai"),
        mentions: ["skeptic"],
      }),
      makePost("other", 2, { author: characterAuthor("architect") }),
    ];

    expect(ids(selectAuthorTimeline(posts, "skeptic", "skeptic"))).toEqual([
      "mention",
      "own",
    ]);
  });

  it("matches mention handles case-insensitively", () => {
    const posts = [makePost("mention", 1, { mentions: ["SKEPTIC"] })];
    expect(ids(selectAuthorTimeline(posts, "skeptic", "skeptic"))).toEqual(["mention"]);
  });

  it("selects the user's own timeline by author id", () => {
    const posts = [
      makePost("user-root", 0, { author: userAuthor }),
      makePost("user-reply", 2, { author: userAuthor, replyTo: "character-post" }),
      makePost("character-post", 1),
    ];

    expect(ids(selectAuthorTimeline(posts, TEST_USER_ID, TEST_USER_HANDLE))).toEqual([
      "user-reply",
      "user-root",
    ]);
  });

  it("returns an empty array for an author with no posts", () => {
    expect(selectAuthorTimeline([makePost("a", 1)], "nobody")).toEqual([]);
  });
});

const FULL_CAPABILITIES: FeedThreadDto["capabilities"] = {
  canOpenAuthor: true,
  canOpenRoom: true,
  canOpenThread: true,
  canReply: true,
  canQuote: true,
  canLoadMoreReplies: true,
};

function makeThread(
  root: PostDto,
  latestReplies: PostDto[],
  overrides: { replyCount?: number; capabilities?: FeedThreadDto["capabilities"] } = {},
): FeedThreadDto {
  return {
    root,
    room: { id: root.roomId, title: "ルーム", isFeed: false },
    latestReplies,
    replyCount: overrides.replyCount ?? latestReplies.length,
    lastActivityAt: root.createdAt,
    capabilities: overrides.capabilities ?? FULL_CAPABILITIES,
  };
}

describe("selectFeedReplyPreview", () => {
  it("returns an empty array when the thread has no previewed replies", () => {
    const thread = makeThread(makePost("root", 0, { author: userAuthor }), []);
    expect(selectFeedReplyPreview(thread)).toEqual([]);
  });

  it("resolves a direct reply to the root's handle", () => {
    const root = makePost("root", 0, { author: userAuthor });
    const reply = makePost("reply", 1, { replyTo: "root", author: characterAuthor("skeptic") });
    const thread = makeThread(root, [reply]);

    const [entry] = selectFeedReplyPreview(thread);
    expect(entry?.post.id).toBe("reply");
    expect(entry?.replyToHandle).toBe(TEST_USER_HANDLE);
  });

  it("resolves a reply-to-reply to the other previewed reply's handle, not the root's", () => {
    const root = makePost("root", 0, { author: userAuthor });
    const first = makePost("first", 1, { replyTo: "root", author: characterAuthor("architect") });
    const second = makePost("second", 2, { replyTo: "first", author: characterAuthor("skeptic") });
    const thread = makeThread(root, [first, second]);

    const preview = selectFeedReplyPreview(thread);
    expect(preview.map((entry) => entry.replyToHandle)).toEqual([TEST_USER_HANDLE, "architect"]);
  });

  it("does not guess a target outside the preview window", () => {
    // "second" actually replies to an earlier reply that did not make the
    // newest-two cut, so the feed cannot know whose handle to show.
    const root = makePost("root", 0, { author: userAuthor });
    const second = makePost("second", 5, { replyTo: "an-earlier-reply-not-previewed" });
    const thread = makeThread(root, [second]);

    expect(selectFeedReplyPreview(thread)[0]?.replyToHandle).toBeNull();
  });

  it("preserves the given oldest-to-newest order rather than re-sorting", () => {
    // Deliberately out of chronological order: the function must trust the
    // server's selection/ordering, not recompute it.
    const root = makePost("root", 0, { author: userAuthor });
    const newer = makePost("newer", 5, { replyTo: "root" });
    const older = makePost("older", 1, { replyTo: "root" });
    const thread = makeThread(root, [newer, older]);

    expect(selectFeedReplyPreview(thread).map((entry) => entry.post.id)).toEqual(["newer", "older"]);
  });
});

describe("resolveReplyDisplay", () => {
  it("resolves every reply in a full expansion, since every ancestor is included", () => {
    // Unlike the two-reply preview, a full expansion (GET
    // /api/posts/:threadRootId/replies) always contains every transitive
    // reply, so a reply-to-an-earlier-reply is always resolvable here.
    const root = makePost("root", 0, { author: userAuthor });
    const first = makePost("first", 1, { replyTo: "root", author: characterAuthor("architect") });
    const second = makePost("second", 2, { replyTo: "first", author: characterAuthor("skeptic") });
    const third = makePost("third", 3, { replyTo: "root", author: characterAuthor("kansai") });

    const display = resolveReplyDisplay(root, [first, second, third]);

    expect(display.map((entry) => entry.replyToHandle)).toEqual([
      TEST_USER_HANDLE,
      "architect",
      TEST_USER_HANDLE,
    ]);
  });

  it("returns an empty array for a root with no replies", () => {
    expect(resolveReplyDisplay(makePost("root", 0, { author: userAuthor }), [])).toEqual([]);
  });
});

describe("selectFeedReplyOverflowCount", () => {
  it("is zero when every reply is already previewed", () => {
    const root = makePost("root", 0, { author: userAuthor });
    const reply = makePost("reply", 1, { replyTo: "root" });
    expect(selectFeedReplyOverflowCount(makeThread(root, [reply]))).toBe(0);
  });

  it("counts replies beyond the previewed two", () => {
    const root = makePost("root", 0, { author: userAuthor });
    const previewed = [makePost("a", 1, { replyTo: "root" }), makePost("b", 2, { replyTo: "root" })];
    expect(selectFeedReplyOverflowCount(makeThread(root, previewed, { replyCount: 5 }))).toBe(3);
  });

  it("never goes negative", () => {
    const root = makePost("root", 0, { author: userAuthor });
    expect(selectFeedReplyOverflowCount(makeThread(root, [], { replyCount: 0 }))).toBe(0);
  });
});
