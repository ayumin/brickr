import type { ApiErrorCode } from "@brickr/shared";

/**
 * A failure the caller caused, carrying the HTTP answer it deserves.
 *
 * The status and code live with the rule that raises the error, so the API
 * boundary (`api/errors.js`'s `handleDomainError`) never needs to know the
 * individual subclasses, and a new domain error cannot be added without
 * deciding what the client is told (CLAUDE.md §55).
 *
 * Not every thrown error is a `DomainError`: a provider failure (`LLMError`)
 * or an internal parsing bug is not something the caller did, and stays a
 * plain `Error` that answers 500.
 */
export abstract class DomainError extends Error {
  abstract readonly httpStatus: number;
  abstract readonly errorCode: ApiErrorCode;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}
