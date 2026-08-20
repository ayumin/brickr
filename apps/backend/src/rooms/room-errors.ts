/**
 * Shared Room domain errors (issue #181).
 *
 * Extracted here to avoid circular imports: room-service.ts imports from
 * room-runtime-service.ts, so placing RoomNotFoundError in either file would
 * create a cycle when the other file needs to import it.
 *
 * Precedent: room-membership-errors.ts exists for the same reason.
 */
import { DomainError } from "../domain-error.js";

/**
 * Thrown by any service when a room cannot be found.
 *
 * All room-related "not found" conditions use this single class so that the
 * API always returns the same errorCode (`room_not_found`) regardless of which
 * service layer detected the absence.
 */
export class RoomNotFoundError extends DomainError {
  readonly httpStatus = 404;
  readonly errorCode = "room_not_found" as const;
  constructor(id: string) {
    super(`room "${id}" not found`);
  }
}
