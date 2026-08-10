import type { LLMImage, LLMImageMediaType } from "./provider.js";

const IMAGE_DATA_URL =
  /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/u;

/** Converts a validated post image data URL into provider-neutral image input. */
export function parseImageDataUrl(dataUrl: string): LLMImage | null {
  const match = IMAGE_DATA_URL.exec(dataUrl);
  if (!match) return null;

  const mediaType = match[1];
  const data = match[2];
  if (!isImageMediaType(mediaType) || data === undefined) return null;

  return { mediaType, data };
}

function isImageMediaType(value: string | undefined): value is LLMImageMediaType {
  return (
    value === "image/png" ||
    value === "image/jpeg" ||
    value === "image/gif" ||
    value === "image/webp"
  );
}
