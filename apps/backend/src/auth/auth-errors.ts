/** Domain errors raised by the auth layer and mapped to status codes in routes.ts. */

export class InvalidCredentialsError extends Error {
  constructor() {
    // Deliberately identical for unknown email and wrong password: the message
    // must not tell an attacker which accounts exist.
    super("email or password is incorrect");
    this.name = "InvalidCredentialsError";
  }
}

export class AccountSuspendedError extends Error {
  constructor() {
    super("this account is suspended");
    this.name = "AccountSuspendedError";
  }
}

export class UnderageSignupError extends Error {
  constructor() {
    super("signup requires an age of 18 or over");
    this.name = "UnderageSignupError";
  }
}

export class InvalidBirthdateError extends Error {
  constructor() {
    super("birthdate must be a calendar date in YYYY-MM-DD form");
    this.name = "InvalidBirthdateError";
  }
}

export class InviteCodeInvalidError extends Error {
  constructor() {
    super("invite code is unknown, already used, or expired");
    this.name = "InviteCodeInvalidError";
  }
}

// Owned by the handles module, which is where the namespace lives (§66.13).
// Re-exported so the auth layer and the routes keep one import site for it.
export { HandleTakenError } from "../handles/handle.js";

export class EmailTakenError extends Error {
  constructor() {
    super("an account with this email already exists");
    this.name = "EmailTakenError";
  }
}

/** Raised by admin-only account actions (suspend, reactivate, reset-password) on an unknown id. */
export class UserNotFoundError extends Error {
  constructor() {
    super("user account not found");
    this.name = "UserNotFoundError";
  }
}
