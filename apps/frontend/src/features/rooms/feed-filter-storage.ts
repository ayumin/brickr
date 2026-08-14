import { FEED_FILTERS, type FeedFilter } from "@brickr/shared";
import { STORAGE_KEYS, readStoredOneOf, writeStored } from "../../services/local-storage";

/** Shared by the feed and by one room (§7.2). An unset or corrupted value falls back to `all`. */
export function readFeedFilter(): FeedFilter {
  return readStoredOneOf(STORAGE_KEYS.feedFilter, FEED_FILTERS) ?? "all";
}

export function writeFeedFilter(filter: FeedFilter): void {
  writeStored(STORAGE_KEYS.feedFilter, filter);
}
