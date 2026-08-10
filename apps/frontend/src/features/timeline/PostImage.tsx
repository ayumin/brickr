export function PostImage({ src, alt = "投稿画像" }: { src: string; alt?: string }) {
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className="mt-3 max-h-[520px] w-full rounded-xl border border-line object-contain bg-surface-raised"
    />
  );
}
