export type SpinnerProps = {
  size?: "sm" | "md" | "lg";
  label?: string;
};

const SIZE_CLASS = {
  sm: "h-4 w-4 border-2",
  md: "h-6 w-6 border-2",
  lg: "h-9 w-9 border-[3px]",
} as const;

export function Spinner({ size = "md", label }: SpinnerProps) {
  return (
    <span className="inline-flex items-center gap-2" role="status">
      <span
        className={`${SIZE_CLASS[size]} brickr-spin rounded-full border-line-strong border-t-accent`}
      />
      {label ? (
        <span className="text-sm text-ink-muted">{label}</span>
      ) : (
        <span className="sr-only">読み込み中</span>
      )}
    </span>
  );
}
