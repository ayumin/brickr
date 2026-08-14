/** Domain errors raised by the auth layer and mapped to status codes via DomainError. */

import { DomainError } from "../domain-error.js";

export class InvalidCredentialsError extends DomainError {
  readonly httpStatus = 401;
  readonly errorCode = "invalid_credentials" as const;
  constructor() {
    // Deliberately identical for unknown email and wrong password: the message
    // must not tell an attacker which accounts exist.
    super("email or password is incorrect");
  }
}

export class AccountSuspendedError extends DomainError {
  readonly httpStatus = 403;
  readonly errorCode = "account_suspended" as const;
  constructor() {
    super("this account is suspended");
  }
}

export class UnderageSignupError extends DomainError {
  readonly httpStatus = 400;
  readonly errorCode = "underage" as const;
  constructor() {
    super("signup requires an age of 18 or over");
  }
}

export class InvalidBirthdateError extends DomainError {
  readonly httpStatus = 400;
  readonly errorCode = "invalid_birthdate" as const;
  constructor() {
    super("birthdate must be a calendar date in YYYY-MM-DD form");
  }
}

export class InviteCodeInvalidError extends DomainError {
  readonly httpStatus = 400;
  readonly errorCode = "invalid_invite_code" as const;
  constructor() {
    super("invite code is unknown, already used, or expired");
  }
}

// Owned by the handles module, which is where the namespace lives (§66.13).
// Re-exported so the auth layer and the routes keep one import site for it.
export { HandleTakenError } from "../handles/handle.js";

export class EmailTakenError extends DomainError {
  readonly httpStatus = 409;
  readonly errorCode = "email_conflict" as const;
  constructor() {
    super("an account with this email already exists");
  }
}

/** Raised by admin-only account actions (suspend, reactivate, reset-password) on an unknown id. */
export class UserNotFoundError extends DomainError {
  readonly httpStatus = 404;
  readonly errorCode = "not_found" as const;
  constructor() {
    super("user account not found");
  }
}
