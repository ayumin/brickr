import { MAX_POST_LENGTH } from "@enjo/shared";
import { describe, expect, it } from "vitest";
import { sanitizeGeneratedPost } from "./sanitize.js";

const SELF = "architect";

describe("sanitizeGeneratedPost", () => {
  describe("pass-through", () => {
    it("leaves plain text unchanged", () => {
      const text = "小規模なら単純検索から始めてもよいと思います。";
      expect(sanitizeGeneratedPost(text, SELF)).toBe(text);
    });

    it("trims surrounding whitespace", () => {
      expect(sanitizeGeneratedPost("  \n本文です。\n\t ", SELF)).toBe("本文です。");
    });

    it("returns an empty string for whitespace-only input", () => {
      expect(sanitizeGeneratedPost("   \n\n  \t ", SELF)).toBe("");
      expect(sanitizeGeneratedPost("", SELF)).toBe("");
    });
  });

  describe("code fences", () => {
    it("unwraps a bare fence", () => {
      expect(sanitizeGeneratedPost("```\n本文です。\n```", SELF)).toBe("本文です。");
    });

    it("unwraps a fence with a language tag", () => {
      expect(sanitizeGeneratedPost("```text\n本文です。\n```", SELF)).toBe("本文です。");
    });

    it("keeps inline backticks that are not a wrapping fence", () => {
      const text = "`useEffect` の依存配列に注意した方がいい。";
      expect(sanitizeGeneratedPost(text, SELF)).toBe(text);
    });
  });

  describe("own byline", () => {
    it("strips a leading @self: byline", () => {
      expect(sanitizeGeneratedPost("@architect: 本文です。", SELF)).toBe("本文です。");
    });

    it("strips the byline case-insensitively", () => {
      expect(sanitizeGeneratedPost("@Architect: 本文です。", SELF)).toBe("本文です。");
      expect(sanitizeGeneratedPost("@ARCHITECT：本文です。", SELF)).toBe("本文です。");
    });

    it("preserves a mention of a different handle in the middle of the text", () => {
      const text = "@skeptic の懸念は分かるが、この条件なら成立すると思う。";
      expect(sanitizeGeneratedPost(text, SELF)).toBe(text);
    });

    it("strips its own byline but keeps a mention of another handle", () => {
      expect(
        sanitizeGeneratedPost("@architect: @skeptic の懸念は分かる。", SELF),
      ).toBe("@skeptic の懸念は分かる。");
    });

    it("does not strip another character's byline", () => {
      const text = "@skeptic: 本文です。";
      expect(sanitizeGeneratedPost(text, SELF)).toBe(text);
    });

    it("escapes regex metacharacters in the handle", () => {
      expect(sanitizeGeneratedPost("@a.b: 本文です。", "a.b")).toBe("本文です。");
      expect(sanitizeGeneratedPost("@axb: 本文です。", "a.b")).toBe("@axb: 本文です。");
    });
  });

  describe("wrapping quotes", () => {
    it("removes wrapping 「」", () => {
      expect(sanitizeGeneratedPost("「本文です。」", SELF)).toBe("本文です。");
    });

    it("removes wrapping 『』", () => {
      expect(sanitizeGeneratedPost("『本文です。』", SELF)).toBe("本文です。");
    });

    it("removes wrapping ASCII double quotes", () => {
      expect(sanitizeGeneratedPost('"本文です。"', SELF)).toBe("本文です。");
    });

    it("removes wrapping curly double quotes", () => {
      expect(sanitizeGeneratedPost("“本文です。”", SELF)).toBe("本文です。");
    });

    it("removes wrapping ASCII single quotes", () => {
      expect(sanitizeGeneratedPost("'本文です。'", SELF)).toBe("本文です。");
    });

    it("keeps quotes used legitimately inside the sentence", () => {
      const text = "これは「重要」な論点だと思う。";
      expect(sanitizeGeneratedPost(text, SELF)).toBe(text);
    });

    it("does not unwrap when the quote marks are two separate quotations", () => {
      const text = "「前提」と「例外」は分けて考えたい」";
      expect(sanitizeGeneratedPost(text, SELF)).toBe(text);
    });

    it("keeps a quoted phrase at the start that does not wrap the whole post", () => {
      const text = "「必要性」の話と「優先度」の話";
      expect(sanitizeGeneratedPost(text, SELF)).toBe(text);
    });
  });

  describe("label prefixes", () => {
    it("strips a 投稿: label", () => {
      expect(sanitizeGeneratedPost("投稿: 本文です。", SELF)).toBe("本文です。");
    });

    it("strips a 本文: label with a full-width colon", () => {
      expect(sanitizeGeneratedPost("本文：本文です。", SELF)).toBe("本文です。");
    });

    it("keeps the same word when it is not used as a label", () => {
      const text = "投稿の順番が結果を変えると思う。";
      expect(sanitizeGeneratedPost(text, SELF)).toBe(text);
    });
  });

  describe("whitespace normalisation", () => {
    it("collapses three or more consecutive newlines into two", () => {
      expect(sanitizeGeneratedPost("一行目\n\n\n\n二行目", SELF)).toBe("一行目\n\n二行目");
      expect(sanitizeGeneratedPost("一行目\n\n\n二行目", SELF)).toBe("一行目\n\n二行目");
    });

    it("leaves a single blank line alone", () => {
      expect(sanitizeGeneratedPost("一行目\n\n二行目", SELF)).toBe("一行目\n\n二行目");
    });
  });

  describe("length cap", () => {
    it("leaves text of exactly MAX_POST_LENGTH untouched", () => {
      const text = "あ".repeat(MAX_POST_LENGTH);
      const result = sanitizeGeneratedPost(text, SELF);

      expect(result).toHaveLength(MAX_POST_LENGTH);
      expect(result.endsWith("…")).toBe(false);
    });

    it("truncates text longer than MAX_POST_LENGTH and marks the cut with …", () => {
      const result = sanitizeGeneratedPost("あ".repeat(MAX_POST_LENGTH + 100), SELF);

      expect(result.length).toBeLessThanOrEqual(MAX_POST_LENGTH);
      expect(result.endsWith("…")).toBe(true);
    });

    it("truncates only after the other cleanup steps have run", () => {
      const result = sanitizeGeneratedPost(`「${"あ".repeat(MAX_POST_LENGTH + 100)}」`, SELF);

      expect(result.startsWith("「")).toBe(false);
      expect(result.length).toBeLessThanOrEqual(MAX_POST_LENGTH);
      expect(result.endsWith("…")).toBe(true);
    });
  });

  it("applies fence, byline and quote stripping together", () => {
    expect(sanitizeGeneratedPost("```\n@architect: 「本文です。」\n```", SELF)).toBe("本文です。");
  });
});
