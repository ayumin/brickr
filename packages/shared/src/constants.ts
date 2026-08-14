/** Max length accepted for a single post body. */
export const MAX_POST_LENGTH = 500;

/** Maximum decoded size of an attached post image (5 MiB). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Data URL ceiling including base64 expansion and MIME prefix. */
export const MAX_IMAGE_DATA_URL_LENGTH = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 128;

/** Maximum encoded avatar image after square cropping (1 MiB decoded). */
export const MAX_AVATAR_IMAGE_BYTES = 1024 * 1024;

/** Data URL ceiling for a cropped avatar. */
export const MAX_AVATAR_DATA_URL_LENGTH =
  Math.ceil((MAX_AVATAR_IMAGE_BYTES * 4) / 3) + 128;

/** Cropped avatars are normalized to this square pixel size. */
export const AVATAR_IMAGE_SIZE = 512;

/** Maximum source file accepted by the browser-side cropper. */
export const MAX_AVATAR_SOURCE_BYTES = 10 * 1024 * 1024;
