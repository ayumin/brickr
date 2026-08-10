import { readFileSync } from "node:fs";

export const DEMO_AVATAR_COUNT = 144;

const avatarCache = new Map<number, string>();
const avatarDirectory = new URL("../../assets/demo-avatars/", import.meta.url);

/**
 * Returns one of the bundled 100x100 JPEG portraits as a database-ready data URL.
 * Indices wrap so bulk creation can continue after every portrait has been used.
 */
export function demoAvatarDataUrl(index: number): string {
  const normalized = ((Math.trunc(index) % DEMO_AVATAR_COUNT) + DEMO_AVATAR_COUNT) % DEMO_AVATAR_COUNT;
  const cached = avatarCache.get(normalized);
  if (cached) return cached;

  const filename = `avatar-${String(normalized + 1).padStart(3, "0")}.jpg`;
  const dataUrl = `data:image/jpeg;base64,${readFileSync(new URL(filename, avatarDirectory)).toString("base64")}`;
  avatarCache.set(normalized, dataUrl);
  return dataUrl;
}
