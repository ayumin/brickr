import { describe, expect, it } from "vitest";
import { tokenizePostContent } from "./post-content";

describe("tokenizePostContent", () => {
  it("extracts HTTP and HTTPS URLs", () => {
    expect(tokenizePostContent("資料は https://example.com/a?x=1 と http://localhost:3000 です")).toEqual([
      { kind: "text", value: "資料は " },
      { kind: "url", value: "https://example.com/a?x=1" },
      { kind: "text", value: " と " },
      { kind: "url", value: "http://localhost:3000" },
      { kind: "text", value: " です" },
    ]);
  });

  it("keeps sentence punctuation outside the link", () => {
    expect(tokenizePostContent("https://example.com/path。次へ")).toEqual([
      { kind: "url", value: "https://example.com/path" },
      { kind: "text", value: "。次へ" },
    ]);
  });

  it("keeps balanced parentheses in a URL and removes an unmatched closer", () => {
    expect(tokenizePostContent("(https://example.com/Foo_(bar))")).toEqual([
      { kind: "text", value: "(" },
      { kind: "url", value: "https://example.com/Foo_(bar)" },
      { kind: "text", value: ")" },
    ]);
  });

  it("does not interpret an @ inside a URL as a mention", () => {
    expect(tokenizePostContent("https://example.com/@architect @architect")).toEqual([
      { kind: "url", value: "https://example.com/@architect" },
      { kind: "text", value: " " },
      { kind: "mention", value: "@architect", handle: "architect" },
    ]);
  });
});
