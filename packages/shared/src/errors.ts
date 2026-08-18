/** Every machine-readable error code the API answers with. */
export const API_ERROR_CODES = [
  "account_suspended",
  "cannot_leave_feed_room",
  "cannot_modify_owner",
  "character_generation_failed",
  "email_conflict",
  "feed_room_immutable",
  "forbidden",
  "handle_conflict",
  "internal_error",
  "invalid_status_transition",
  "invalid_birthdate",
  "invalid_body",
  "invalid_credentials",
  "invalid_csv",
  "invalid_cursor",
  "invalid_invite_code",
  "invalid_params",
  "invalid_query",
  "invalid_setting",
  "invalid_budget",
  "invitation_not_found",
  "member_already_exists",
  "member_banned",
  "membership_not_found",
  // Room authorization producers are introduced by follow-up issues #151/#152.
  "membership_required",
  "not_a_member",
  "not_found",
  "owner_cannot_leave",
  "request_not_found",
  "room_already_member",
  "room_archived",
  "room_join_not_allowed",
  "room_member_banned",
  "room_not_archived",
  "room_not_found",
  "snapshot_not_found",
  "unauthenticated",
  "underage",
  "user_not_found",
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
