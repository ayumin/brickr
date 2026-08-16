/** Every machine-readable error code the API answers with. */
export const API_ERROR_CODES = [
  "account_suspended",
  "character_generation_failed",
  "email_conflict",
  "forbidden",
  "handle_conflict",
  "internal_error",
  "invalid_birthdate",
  "invalid_body",
  "invalid_credentials",
  "invalid_csv",
  "invalid_cursor",
  "invalid_invite_code",
  "invalid_params",
  "invalid_query",
  "invalid_setting",
  // Room authorization producers are introduced by follow-up issues #151/#152.
  "membership_required",
  "not_found",
  "room_archived",
  "room_not_archived",
  "room_not_found",
  "unauthenticated",
  "underage",
  "visibility_immutable",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
};
