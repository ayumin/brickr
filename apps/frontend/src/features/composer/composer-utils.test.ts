import { describe, expect, it } from "vitest";
import { appendMentionOnce } from "./composer-utils";

describe("appendMentionOnce", () => {
  it("adds a mention to empty content", () => {
    expect(appendMentionOnce("", "skeptic")).toBe("@skeptic ");
  });

  it("does not add the same mention twice", () => {
    const once = appendMentionOnce("", "skeptic");
    expect(appendMentionOnce(once, "skeptic")).toBe("@skeptic ");
  });

  it("matches existing handles case-insensitively", () => {
    expect(appendMentionOnce("@SKEPTIC 質問です", "skeptic")).toBe(
      "@SKEPTIC 質問です",
    );
  });

  it("still permits mentioning a different character", () => {
    expect(appendMentionOnce("@skeptic 質問です", "architect")).toBe(
      "@skeptic 質問です @architect ",
    );
  });
});
