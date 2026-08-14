import type { UserAccount } from "../auth/user-account.js";
import type { FeedReader } from "../feed/feed-service.js";

/**
 * The signed-in reader as the feed sees them: an id, an admin flag and a handle,
 * the last one because `filter=mine` matches mentions by handle (§12.3).
 */
export function toFeedReader(user: UserAccount): NonNullable<FeedReader> {
  return { id: user.id, isAdmin: user.isAdmin, handle: user.handle };
}
