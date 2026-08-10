import { USER_HANDLE } from "@enjo/shared";
import type { Character } from "../characters/character.js";
import type { LLMMessage } from "../llm/provider.js";
import { parseImageDataUrl } from "../llm/image-data-url.js";
import type { Post } from "../posts/post.js";
import type { ResponseAction } from "../simulation/simulation.js";

/**
 * Rules shared by every character. Deliberately kept out of the per-character
 * seed prompts so persona text contains only what is unique to that character.
 */
const SHARED_RULES = [
  "日本語で書く。",
  "長さはSNSの1投稿ぶん。80〜140文字に収める。140文字を超えてはいけない。",
  "言いたいことが複数あっても、一番大事な一点だけに絞る。論点を並べて長くしない。",
  "前置き・自己紹介・締めの挨拶は書かない。本題だけを書く。",
  "自分の役割を説明しない。役柄を大げさに演じない。",
  "他の人の投稿に同意・補足・反論・訂正してよい。",
  "他の人に言及するときだけ @handle を使う。無理に使わない。",
  "すでに出ている意見をそのまま繰り返さない。",
  "箇条書きや見出しは使わない。地の文で書く。",
  "投稿本文だけを出力する。名前や @handle の署名、引用符、前後の説明は付けない。",
].join("\n");

const ACTION_INSTRUCTIONS: Record<ResponseAction, string> = {
  reply:
    "この投稿への「返信」を書く。相手の言っていることに直接反応する。",
  quote:
    "この投稿を「引用」して、自分のタイムラインに向けて一言書く。相手に語りかけるのではなく、読者に向けて自分の見方を示す。",
  post: "この話題について自分の投稿を書く。特定の相手に返信するのではなく、独立した意見として書く。",
};

/** Resolves an author id to the handle shown in the transcript. */
export type HandleResolver = (authorId: string) => string;

export function buildSystemPrompt(character: Character): string {
  const sections: string[] = [
    `あなたはSNS上の人物「${character.displayName}」(@${character.handle}) として投稿します。`,
    `【立場・考え方】\n${character.rolePrompt.trim()}`,
    `【話し方】\n${character.tonePrompt.trim()}`,
  ];

  if (character.dialectPrompt) {
    sections.push(`【言葉づかい】\n${character.dialectPrompt.trim()}`);
  }

  if (character.interests.length > 0) {
    sections.push(`【関心のあること】\n${character.interests.join("、")}`);
  }

  sections.push(`【共通ルール】\n${SHARED_RULES}`);

  return sections.join("\n\n");
}

/**
 * Renders the thread as a transcript. One `user` message keeps the whole
 * conversation in view, which is what lets a character react to what others
 * have already said.
 */
export function buildMessages(input: {
  character: Character;
  target: Post;
  posts: Post[];
  action: ResponseAction;
  resolveHandle: HandleResolver;
}): LLMMessage[] {
  const { character, target, posts, action, resolveHandle } = input;

  const images = posts.flatMap((post) => {
    if (!post.imageUrl) return [];
    const image = parseImageDataUrl(post.imageUrl);
    return image ? [{ postId: post.id, image }] : [];
  });
  const imageNumberByPostId = new Map(
    images.map(({ postId }, index) => [postId, index + 1]),
  );

  const transcript = posts
    .map((post) => {
      const handle = resolveHandle(post.authorId);
      const label = handle === USER_HANDLE ? `@${USER_HANDLE} (投稿者)` : `@${handle}`;
      const marks: string[] = [];
      if (post.replyTo) marks.push(`@${resolveHandle(authorOf(posts, post.replyTo))} への返信`);
      if (post.quoteOf) marks.push(`@${resolveHandle(authorOf(posts, post.quoteOf))} の引用`);
      const prefix = marks.length > 0 ? `[${marks.join(" / ")}] ` : "";
      return `${label}:\n${prefix}${contextContent(post, imageNumberByPostId.get(post.id))}`;
    })
    .join("\n\n");

  const targetHandle = resolveHandle(target.authorId);
  const isSelfTarget = target.authorId === character.id;

  const instruction = [
    "以下はいまのタイムラインです。",
    "",
    transcript,
    "",
    `--- ここまで ---`,
    "",
    isSelfTarget
      ? "上のタイムライン全体を踏まえて投稿してください。"
      : `反応する対象は @${targetHandle} の次の投稿です。\n「${truncate(contextContent(target, imageNumberByPostId.get(target.id)), 200)}」`,
    "",
    ACTION_INSTRUCTIONS[action],
    "",
    `@${character.handle} としての投稿本文を1つだけ書いてください。`,
  ].join("\n");

  return [{
    role: "user",
    content: instruction,
    ...(images.length > 0 ? { images: images.map(({ image }) => image) } : {}),
  }];
}

function authorOf(posts: Post[], postId: string): string {
  return posts.find((post) => post.id === postId)?.authorId ?? postId;
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function contextContent(post: Post, imageNumber?: number): string {
  if (!post.imageUrl) return post.content;
  const marker = imageNumber === undefined ? "[画像添付あり]" : `[添付画像${imageNumber}]`;
  return post.content.length > 0
    ? `${post.content}\n${marker}`
    : marker;
}
