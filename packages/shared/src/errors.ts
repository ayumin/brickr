/** Every machine-readable error code the API answers with. */
export type ApiErrorCode =
  | "account_suspended"
  | "character_generation_failed"
  | "email_conflict"
  | "forbidden"
  | "handle_conflict"
  | "internal_error"
  | "invalid_birthdate"
  | "invalid_body"
  | "invalid_credentials"
  | "invalid_csv"
  | "invalid_cursor"
  | "invalid_invite_code"
  | "invalid_params"
  | "invalid_query"
  | "invalid_setting"
  | "not_found"
  | "simulation_stopped"
  | "unauthenticated"
  | "underage";

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
};
