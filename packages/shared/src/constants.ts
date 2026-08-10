/** Author id used for posts written by the human user. */
export const USER_AUTHOR_ID = "you";

/** Handle rendered for the human user in the timeline and in LLM context. */
export const USER_HANDLE = "you";

/** Display name rendered for the human user. */
export const USER_DISPLAY_NAME = "あなた";

/** Max length accepted for a single post body. */
export const MAX_POST_LENGTH = 500;

/** Maximum decoded size of an attached post image (5 MiB). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Data URL ceiling including base64 expansion and MIME prefix. */
export const MAX_IMAGE_DATA_URL_LENGTH = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 128;
