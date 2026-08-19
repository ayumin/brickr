import { DomainError } from "../domain-error.js";

/** The owner's membership anchors room ownership and cannot be removed or banned. */
export class CannotModifyOwnerError extends DomainError {
  readonly httpStatus = 409;
  readonly errorCode = "cannot_modify_owner" as const;
  constructor() {
    super("the room owner's membership cannot be removed or banned");
  }
}
