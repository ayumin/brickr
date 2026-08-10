/**
 * Deterministic, offline avatar: the handle picks a hue, so a character keeps
 * the same colour everywhere without any remote asset.
 */
export type AvatarSize = "xs" | "sm" | "md" | "lg";

export type AvatarProps = {
  handle: string;
  displayName: string;
  avatarUrl?: string | null;
  size?: AvatarSize;
};

const SIZE_CLASS: Record<AvatarSize, string> = {
  xs: "h-6 w-6 text-[11px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-xl",
};

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

/** First visible character, surrogate-pair safe. */
function initial(displayName: string, handle: string): string {
  const source = displayName.trim() || handle.trim();
  const first = Array.from(source)[0];
  return first ?? "?";
}

export function Avatar({
  handle,
  displayName,
  avatarUrl,
  size = "md",
}: AvatarProps) {
  const hue = hashString(handle) % 360;
  const secondHue = (hue + 32) % 360;

  const classes = `${SIZE_CLASS[size]} shrink-0 select-none overflow-hidden rounded-full ring-1 ring-white/10`;

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={`${displayName} のアバター`}
        className={`${classes} object-cover`}
        loading="lazy"
      />
    );
  }

  return (
    <div
      className={`${classes} flex items-center justify-center font-semibold text-white/95`}
      style={{
        backgroundImage: `linear-gradient(135deg, hsl(${String(hue)} 58% 44%), hsl(${String(secondHue)} 52% 26%))`,
      }}
      aria-hidden="true"
    >
      {initial(displayName, handle)}
    </div>
  );
}
