import { Fragment } from "react";
import { tokenizePostContent } from "./post-content";

export function PostContent({
  content,
  knownHandles,
  onOpenHandle,
}: {
  content: string;
  knownHandles?: ReadonlySet<string>;
  onOpenHandle?: (handle: string) => void;
}) {
  return tokenizePostContent(content).map((token, index) => {
    const key = `${token.kind}-${String(index)}`;
    if (token.kind === "text") return <Fragment key={key}>{token.value}</Fragment>;

    if (token.kind === "url") {
      return (
        <a
          key={key}
          href={token.value}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-accent underline decoration-accent/40 underline-offset-2 transition hover:decoration-accent"
        >
          {token.value}
        </a>
      );
    }

    const shouldRenderMention = knownHandles !== undefined || onOpenHandle !== undefined;
    if (!shouldRenderMention) return <Fragment key={key}>{token.value}</Fragment>;
    const isKnown = knownHandles ? knownHandles.has(token.handle) : true;
    if (isKnown && onOpenHandle) {
      return (
        <button
          key={key}
          type="button"
          onClick={() => onOpenHandle(token.handle)}
          className="cursor-pointer rounded text-accent transition hover:underline"
        >
          {token.value}
        </button>
      );
    }
    return (
      <span key={key} className={isKnown ? "text-accent" : "text-ink-muted"}>
        {token.value}
      </span>
    );
  });
}
