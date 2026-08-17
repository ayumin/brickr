export function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <img
      src="/brickr-logo.png"
      alt=""
      aria-hidden="true"
      draggable={false}
      className={`inline-block shrink-0 object-contain ${className}`}
    />
  );
}
