export type IconName =
  | "arrow-left"
  | "arrow-down-up"
  | "arrows-angle-expand"
  | "caret-down-fill"
  | "caret-up-fill"
  | "download"
  | "fire"
  | "gear"
  | "image"
  | "list"
  | "magic"
  | "people"
  | "pencil"
  | "person-bounding-box"
  | "plus-lg"
  | "plus-circle"
  | "repeat"
  | "recycle"
  | "search"
  | "trash"
  | "upload"
  | "x-lg";

export function Icon({
  name,
  className = "",
}: {
  name: IconName;
  className?: string;
}) {
  return <i className={`bi bi-${name} ${className}`} aria-hidden="true" />;
}
