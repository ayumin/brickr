import { describe, expect, it } from "vitest";
import { parseMentions, resolveKnownMentions } from "./mention-parser.js";

const KNOWN_HANDLES = ["architect", "skeptic", "kansai", "oldtimer"] as const;

describe("parseMentions", () => {
  it("returns an empty array for text without mentions", () => {
    expect(parseMentions("RAGって本当に必要？")).toEqual([]);
    expect(parseMentions("")).toEqual([]);
  });

  it("extracts a single mention", () => {
    expect(parseMentions("@skeptic")).toEqual(["skeptic"]);
  });

  it("extracts multiple mentions", () => {
    expect(parseMentions("@architect and @skeptic and @kansai")).toEqual([
      "architect",
      "skeptic",
      "kansai",
    ]);
  });

  it("preserves first-appearance order rather than sorting", () => {
    expect(parseMentions("@kansai @architect @skeptic")).toEqual([
      "kansai",
      "architect",
      "skeptic",
    ]);
  });

  it("normalises handles to lowercase", () => {
    expect(parseMentions("@Skeptic @ARCHITECT @KanSai")).toEqual([
      "skeptic",
      "architect",
      "kansai",
    ]);
  });

  it("de-duplicates repeated mentions, including across casing", () => {
    expect(parseMentions("@skeptic @Skeptic @SKEPTIC @skeptic")).toEqual(["skeptic"]);
  });

  it("finds a mention at the start of the text", () => {
    expect(parseMentions("@skeptic この企画どう思う？")).toEqual(["skeptic"]);
  });

  it("finds a mention in the middle of the text", () => {
    expect(parseMentions("さっきの話は @architect の指摘が正しいと思う")).toEqual(["architect"]);
  });

  it("finds a mention at the end of the text", () => {
    expect(parseMentions("この件どう見る？ @kansai")).toEqual(["kansai"]);
  });

  it("handles Japanese text directly adjacent to a mention", () => {
    expect(parseMentions("@skepticこの企画どう思う？")).toEqual(["skeptic"]);
    expect(parseMentions("そこは@architectの言うとおり")).toEqual(["architect"]);
  });

  it("stops the handle at punctuation immediately after it", () => {
    expect(parseMentions("@skeptic、それは違うと思う")).toEqual(["skeptic"]);
    expect(parseMentions("@skeptic!")).toEqual(["skeptic"]);
    expect(parseMentions("@skeptic。")).toEqual(["skeptic"]);
    expect(parseMentions("(@kansai)")).toEqual(["kansai"]);
  });

  it("does not treat an email address as a mention", () => {
    expect(parseMentions("user@example.com まで連絡ください")).toEqual([]);
    expect(parseMentions("問い合わせは info@enjo.test へ")).toEqual([]);
  });

  it("parses consecutive mentions separated by a single space", () => {
    expect(parseMentions("@a @b")).toEqual(["a", "b"]);
  });

  it("parses consecutive mentions separated by a newline", () => {
    expect(parseMentions("@architect\n@skeptic の懸念は分かる")).toEqual([
      "architect",
      "skeptic",
    ]);
  });

  it("ignores a bare @ and a doubled @@", () => {
    expect(parseMentions("@")).toEqual([]);
    expect(parseMentions("値段は @ で区切る")).toEqual([]);
    expect(parseMentions("@@x")).toEqual([]);
  });

  it("accepts underscores and digits inside a handle", () => {
    expect(parseMentions("@old_timer2 の意見")).toEqual(["old_timer2"]);
    expect(parseMentions("@_leading")).toEqual(["_leading"]);
    expect(parseMentions("@123")).toEqual(["123"]);
  });

  it("stops a handle at a character outside [A-Za-z0-9_]", () => {
    expect(parseMentions("@old-timer")).toEqual(["old"]);
  });

  it("accepts a handle of exactly 32 characters", () => {
    const handle = "a".repeat(32);
    expect(parseMentions(`@${handle}`)).toEqual([handle]);
  });

  it("caps a handle at 32 characters", () => {
    const parsed = parseMentions(`@${"b".repeat(40)}`);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toBe("b".repeat(32));
  });
});

describe("resolveKnownMentions", () => {
  it("keeps only handles that exist", () => {
    expect(resolveKnownMentions("@architect と @skeptic はどう？", KNOWN_HANDLES)).toEqual([
      "architect",
      "skeptic",
    ]);
  });

  it("drops handles that are not in the known set without throwing", () => {
    expect(() => resolveKnownMentions("@ghostwriter どう思う？", KNOWN_HANDLES)).not.toThrow();
    expect(resolveKnownMentions("@ghostwriter どう思う？", KNOWN_HANDLES)).toEqual([]);
  });

  it("keeps the known handles and drops an invented one in mixed text", () => {
    expect(resolveKnownMentions("@architect @totally_made_up @kansai", KNOWN_HANDLES)).toEqual([
      "architect",
      "kansai",
    ]);
  });

  it("matches known handles case-insensitively on both sides", () => {
    expect(resolveKnownMentions("@SKEPTIC どう？", ["Skeptic"])).toEqual(["skeptic"]);
  });

  it("returns an empty array when the known set is empty", () => {
    expect(resolveKnownMentions("@architect @skeptic", [])).toEqual([]);
  });

  it("preserves first-appearance order and de-duplication", () => {
    expect(resolveKnownMentions("@kansai @architect @Kansai @kansai", KNOWN_HANDLES)).toEqual([
      "kansai",
      "architect",
    ]);
  });
});
