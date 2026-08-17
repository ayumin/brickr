import { ApiError } from "../../services/api-client";

export type HandleResolutionErrorKind = "not-found" | "error";

/**
 * A 404 from `GET /api/profiles/:handle` is a genuine, permanent answer: that
 * handle has no owner, and asking again will not change that. Anything else
 * (network failure, 5xx, an aborted request that wasn't actually cancelled by
 * us) is transient and must not be cached as if it were a real answer - see
 * `PublicProfileScreen`'s profile-resolution effect for where this
 * classification decides whether to allow a retry.
 */
export function classifyHandleResolutionError(cause: unknown): HandleResolutionErrorKind {
  return cause instanceof ApiError && cause.isNotFound ? "not-found" : "error";
}
