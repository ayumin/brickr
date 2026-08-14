/**
 * The opaque cursor the feed pages with (§9.4).
 *
 * `threadActivityAt` alone cannot page safely: two replies can land in the same
 * millisecond, and a page boundary that falls between them would repeat or drop
 * a thread. The root post id is the tiebreaker that turns the ordering into a
 * total one.
 */
export type FeedCursor = {
  activityAt: Date;
  id: string;
};

/**
 * A cursor the client did not get from us, or one we can no longer read.
 *
 * Answered as 400 rather than ignored: silently serving page one for a corrupt
 * cursor looks like a working feed that has quietly lost the reader's place.
 */
export class FeedCursorInvalidError extends Error {
  constructor() {
    super("cursor is invalid");
    this.name = "FeedCursorInvalidError";
  }
}

type CursorPayload = {
  activityAt: string;
  id: string;
};

/**
 * Base64URL so it survives a query string untouched, JSON inside so the shape
 * can grow. Deliberately opaque rather than readable: the ordering it encodes is
 * ours to change, and a client that parsed it would break when we do.
 */
export function encodeFeedCursor(cursor: FeedCursor): string {
  const payload: CursorPayload = {
    activityAt: cursor.activityAt.toISOString(),
    id: cursor.id,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeFeedCursor(value: string): FeedCursor {
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    // Anything unparseable is the same answer: not a cursor we issued.
    throw new FeedCursorInvalidError();
  }

  if (typeof payload !== "object" || payload === null) throw new FeedCursorInvalidError();

  const { activityAt, id } = payload as Partial<CursorPayload>;
  if (typeof activityAt !== "string" || typeof id !== "string" || id.length === 0) {
    throw new FeedCursorInvalidError();
  }

  const parsed = new Date(activityAt);
  if (Number.isNaN(parsed.getTime())) throw new FeedCursorInvalidError();

  return { activityAt: parsed, id };
}
