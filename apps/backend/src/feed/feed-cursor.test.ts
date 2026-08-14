import { describe, expect, it } from "vitest";
import {
  decodeFeedCursor,
  encodeFeedCursor,
  FeedCursorInvalidError,
  type FeedCursor,
} from "./feed-cursor.js";

const cursor: FeedCursor = {
  activityAt: new Date("2026-08-13T10:00:00.000Z"),
  id: "11111111-1111-4111-8111-111111111111",
};

describe("feed cursor (§9.4)", () => {
  it("survives a round trip with the millisecond and the tiebreaker intact", () => {
    const decoded = decodeFeedCursor(encodeFeedCursor(cursor));

    expect(decoded.activityAt.toISOString()).toBe("2026-08-13T10:00:00.000Z");
    expect(decoded.id).toBe(cursor.id);
  });

  /**
   * Base64URL rather than plain JSON in the query string: the value has to survive
   * a URL untouched, and a client that could read it would start depending on an
   * ordering the server means to keep changeable.
   */
  it("is opaque and URL-safe", () => {
    const encoded = encodeFeedCursor(cursor);

    expect(encoded).not.toContain(cursor.id);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(encodeURIComponent(encoded)).toBe(encoded);
  });

  it("keeps two threads from the same millisecond apart", () => {
    const sameMoment = encodeFeedCursor({ ...cursor, id: "22222222-2222-4222-8222-222222222222" });

    expect(sameMoment).not.toBe(encodeFeedCursor(cursor));
  });

  const rejected = [
    { name: "not base64 at all", value: "!!!!" },
    { name: "base64 that is not JSON", value: Buffer.from("nope").toString("base64url") },
    { name: "JSON that is not an object", value: Buffer.from('"cursor"').toString("base64url") },
    {
      name: "an object without an id",
      value: Buffer.from('{"activityAt":"2026-08-13T10:00:00.000Z"}').toString("base64url"),
    },
    {
      name: "an empty id",
      value: Buffer.from('{"activityAt":"2026-08-13T10:00:00.000Z","id":""}').toString("base64url"),
    },
    {
      name: "an unparseable date",
      value: Buffer.from('{"activityAt":"yesterday","id":"p1"}').toString("base64url"),
    },
  ];

  /**
   * Every one of these is refused rather than treated as "start from the top":
   * quietly serving page one looks like a feed that lost the reader's place.
   */
  it.each(rejected)("refuses $name", ({ value }) => {
    expect(() => decodeFeedCursor(value)).toThrow(FeedCursorInvalidError);
  });
});
