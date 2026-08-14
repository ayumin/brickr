/**
 * A fixed aspect ratio reserves the image's box before it loads, so finishing
 * the load never changes the layout around it - which matters beyond looks:
 * the feed's scroll-anchor correction (§12.4) only runs when the thread list
 * itself reorders, so a layout shift from an image loading afterwards would
 * otherwise go uncorrected.
 */
export function PostImage({ src, alt = "投稿画像" }: { src: string; alt?: string }) {
  return (
    <div className="mt-3 aspect-video w-full overflow-hidden rounded-xl border border-line bg-surface-raised">
      <img src={src} alt={alt} loading="lazy" className="h-full w-full object-cover" />
    </div>
  );
}
