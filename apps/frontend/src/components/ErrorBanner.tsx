export type ErrorBannerTone = "error" | "warning";

export type ErrorBannerProps = {
  message: string;
  detail?: string;
  tone?: ErrorBannerTone;
  onRetry?: () => void;
  retryLabel?: string;
  onDismiss?: () => void;
};

const TONE_CLASS: Record<ErrorBannerTone, string> = {
  error: "border-danger/40 bg-danger/10 text-danger",
  warning: "border-warn/40 bg-warn/10 text-warn",
};

export function ErrorBanner({
  message,
  detail,
  tone = "error",
  onRetry,
  retryLabel = "再試行",
  onDismiss,
}: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className={`flex flex-wrap items-start gap-3 rounded-xl border px-4 py-3 text-sm ${TONE_CLASS[tone]}`}
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium break-words">{message}</p>
        {detail ? (
          <p className="mt-1 text-xs break-words opacity-80">{detail}</p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full border border-current/40 px-3 py-1 text-xs font-medium transition hover:bg-current/10"
          >
            {retryLabel}
          </button>
        ) : null}
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="閉じる"
            className="rounded-full border border-current/30 px-2 py-1 text-xs leading-none transition hover:bg-current/10"
          >
            <Icon name="x-lg" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
import { Icon } from "./Icon";
