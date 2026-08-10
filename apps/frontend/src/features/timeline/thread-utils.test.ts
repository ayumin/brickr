import { describe, expect, it } from "vitest";
import { USER_AUTHOR_ID } from "@enjo/shared";
import type { PostAuthorDto, PostDto } from "@enjo/shared";

import {
  buildReplyIndex,
  buildRepostIndex,
  countReplies,
  countReposts,
  flattenReplies,
  selectAuthorTimeline,
  selectReposts,
  selectUserThreads,
} from "./thread-utils";

const userAuthor: PostAuthorDto = {
  id: USER_AUTHOR_ID,
  kind: "user",
  handle: "you",
  displayName: "あなた",
};

function characterAuthor(id: string): PostAuthorDto {
  return { id, kind: "character", handle: id, displayName: id.toUpperCase() };
}

type PostOverrides = {
  author?: PostAuthorDto;
  content?: string;
  replyTo?: string | null;
  quoteOf?: string | null;
  quoted?: boolean;
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
    simulationId: "sim_1",
    authorId: author.id,
    author,
    content: overrides.content ?? `post ${id}`,
    mentions: [],
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

describe("selectUserThreads", () => {
  it("keeps only user-authored thread starters, newest first", () => {
    const posts = [
      makePost("user-1", 1, { author: userAuthor }),
      makePost("user-reply", 2, { author: userAuthor, replyTo: "user-1" }),
      makePost("character-post", 3),
      makePost("character-reply", 4, { replyTo: "user-1" }),
      makePost("user-2", 5, { author: userAuthor }),
    ];

    expect(ids(selectUserThreads(posts))).toEqual(["user-2", "user-1"]);
  });

  it("keeps a user repost, because it still starts a thread", () => {
    const posts = [
      makePost("user-repost", 2, { author: userAuthor, quoteOf: "character-post" }),
      makePost("character-post", 1),
    ];

    expect(ids(selectUserThreads(posts))).toEqual(["user-repost"]);
  });

  it("returns an empty array when the user has not posted", () => {
    expect(selectUserThreads([makePost("only-character", 1)])).toEqual([]);
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

    expect(ids(selectAuthorTimeline(posts, "skeptic"))).toEqual([
      "repost",
      "reply",
      "standalone",
    ]);
  });

  it("selects the user's own timeline by author id", () => {
    const posts = [
      makePost("user-root", 0, { author: userAuthor }),
      makePost("user-reply", 2, { author: userAuthor, replyTo: "character-post" }),
      makePost("character-post", 1),
    ];

    expect(ids(selectAuthorTimeline(posts, USER_AUTHOR_ID))).toEqual([
      "user-reply",
      "user-root",
    ]);
  });

  it("returns an empty array for an author with no posts", () => {
    expect(selectAuthorTimeline([makePost("a", 1)], "nobody")).toEqual([]);
  });
});
