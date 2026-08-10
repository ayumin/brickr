export function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <span
      className={`brand-logo relative inline-flex shrink-0 overflow-hidden ${className}`}
      aria-hidden="true"
    >
      <img
        src="/brickr-logo.svg"
        alt=""
        draggable={false}
        className="brand-logo__light absolute inset-0 h-full w-full scale-[1.45] object-contain"
      />
      <img
        src="/brickr-logo-dark.svg"
        alt=""
        draggable={false}
        className="brand-logo__dark absolute inset-0 h-full w-full scale-[1.45] object-contain"
      />
    </span>
  );
}
