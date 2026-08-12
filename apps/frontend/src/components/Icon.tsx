export type IconName =
  | "arrow-left"
  | "arrow-down-up"
  | "box-arrow-in-right"
  | "arrows-angle-expand"
  | "caret-down-fill"
  | "caret-up-fill"
  | "chat-dots"
  | "chevron-left"
  | "chevron-right"
  | "clipboard"
  | "clock-history"
  | "download"
  | "gear"
  | "image"
  | "key"
  | "list"
  | "magic"
  | "people"
  | "pencil"
  | "person-bounding-box"
  | "person-check"
  | "person-x"
  | "plus-lg"
  | "plus-circle"
  | "repeat"
  | "sidebar"
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
