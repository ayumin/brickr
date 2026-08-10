import { useEffect, useState } from "react";
import { MAX_IMAGE_BYTES, MAX_POST_LENGTH } from "@brickr/shared";
import type {
  CharacterDto,
  CreatePostRequest,
  PostDto,
  UserProfileDto,
} from "@brickr/shared";

import { Avatar } from "../../components/Avatar";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Spinner } from "../../components/Spinner";
import { api, toErrorMessage } from "../../services/api-client";
import type { ComposerScope } from "../../types";
import { QuotePost } from "../timeline/QuotePost";
import { Icon } from "../../components/Icon";
import { MentionInput } from "./MentionInput";
import { appendMentionOnce } from "./composer-utils";

const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export type ComposerProps = {
  simulationId: string;
  characters: CharacterDto[];
  userProfile: UserProfileDto;
  disabled?: boolean;
  disabledReason?: string;
  onPosted: (post: PostDto) => void;
  /** Clicking the user's avatar returns to the unified home timeline. */
  onOpenUser?: () => void;
  /**
   * Inline mode: the post is scoped to an existing post, either as a reply
   * (`replyTo`) or as a repost/quote (`quoteOf`). Omitted at the top of the
   * page, where the composer only ever starts new threads.
   */
  scope?: ComposerScope | null;
  /** Inline mode: collapse the composer. */
  onCancel?: () => void;
  compact?: boolean;
  autoFocus?: boolean;
  /** Handle to append as a mention, e.g. from a profile header. */
  pendingMention?: string | null;
  onPendingMentionConsumed?: () => void;
};

export function Composer({
  simulationId,
  characters,
  userProfile,
  disabled = false,
  disabledReason,
  onPosted,
  onOpenUser,
  scope,
  onCancel,
  compact = false,
  autoFocus = false,
  pendingMention,
  onPendingMentionConsumed,
}: ComposerProps) {
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  // Replying to a character pre-fills the mention, like a normal SNS client.
  useEffect(() => {
    if (!scope || scope.mode !== "reply") {
      return;
    }
    if (scope.post.author.kind !== "character") {
      return;
    }
    const handle = scope.post.author.handle;
    setContent((current) =>
      current.trim().length === 0 ? `@${handle} ` : current,
    );
  }, [scope]);

  // StrictMode can run this effect twice; appendMentionOnce keeps it idempotent.
  useEffect(() => {
    if (!pendingMention) {
      return;
    }
    setContent((current) => appendMentionOnce(current, pendingMention));
    onPendingMentionConsumed?.();
  }, [pendingMention, onPendingMentionConsumed]);

  const remaining = MAX_POST_LENGTH - content.length;
  const overLimit = remaining < 0;
  const isEmpty = content.trim().length === 0 && imageUrl === null;
  const canSubmit = !disabled && !submitting && !isEmpty && !overLimit;

  const submit = async (): Promise<void> => {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    setError(null);

    // `responderIds` still exists in the API, but the UI no longer populates it:
    // an @mention in the body is the only way to force a specific character.
    const request: CreatePostRequest = {
      content: content.trim(),
      ...(!scope && imageUrl ? { imageUrl } : {}),
      ...(scope?.mode === "reply" ? { replyTo: scope.post.id } : {}),
      ...(scope?.mode === "quote" ? { quoteOf: scope.post.id } : {}),
    };

    try {
      const post = await api.createPost(simulationId, request);
      // Show the user's own post immediately; SSE brings the characters later.
      onPosted(post);
      setContent("");
      setImageUrl(null);
      onCancel?.();
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const placeholder =
    scope?.mode === "quote"
      ? "コメントを添えてリポスト…"
      : scope?.mode === "reply"
        ? "返信を書く…"
        : "いま何が起きてる？　@ でキャラクターを指名できます";

  const selectImage = (file: File | undefined): void => {
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      setError("PNG、JPEG、GIF、WebP形式の画像を選択してください。");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("画像は5MB以下にしてください。");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setImageUrl(reader.result);
        setError(null);
      }
    };
    reader.onerror = () => setError("画像を読み込めませんでした。");
    reader.readAsDataURL(file);
  };

  return (
    <form
      className={
        compact
          ? "border-b border-line bg-surface px-4 py-3"
          : "border-b border-line px-4 py-3"
      }
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {compact && scope ? (
        <p className="mb-1.5 text-xs text-ink-faint">
          {scope.mode === "reply" ? "返信先" : "リポスト元"}:{" "}
          <span className="text-accent">@{scope.post.author.handle}</span>
        </p>
      ) : null}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onOpenUser}
          disabled={!onOpenUser}
          aria-label="あなたのホームを開く"
          className="h-fit shrink-0 rounded-full disabled:cursor-default"
        >
          <Avatar
            handle={userProfile.handle}
            displayName={userProfile.displayName}
            avatarUrl={userProfile.avatarUrl}
            size={compact ? "sm" : "md"}
          />
        </button>

        <div className="min-w-0 flex-1">
          <MentionInput
            value={content}
            onChange={setContent}
            characters={characters}
            disabled={disabled || submitting}
            placeholder={placeholder}
            compact={compact}
            autoFocus={autoFocus}
            onSubmit={() => {
              void submit();
            }}
          />

          {scope?.mode === "quote" ? (
            <QuotePost
              post={{
                id: scope.post.id,
                author: scope.post.author,
                content: scope.post.content,
                ...(scope.post.imageUrl ? { imageUrl: scope.post.imageUrl } : {}),
                createdAt: scope.post.createdAt,
              }}
            />
          ) : null}

          {!scope ? (
            <div className="mt-2">
              {imageUrl ? (
                <div className="relative overflow-hidden rounded-xl border border-line bg-surface-raised">
                  <img
                    src={imageUrl}
                    alt="添付画像のプレビュー"
                    className="max-h-80 w-full object-contain"
                  />
                  <button
                    type="button"
                    onClick={() => setImageUrl(null)}
                    className="absolute right-2 top-2 rounded-full bg-black/70 px-2.5 py-1 text-xs text-white hover:bg-black/85"
                  >
                    削除
                  </button>
                </div>
              ) : (
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-ink-muted transition hover:border-accent/50 hover:text-accent">
                  <Icon name="image" />
                  画像を添付
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    disabled={disabled || submitting}
                    onChange={(event) => selectImage(event.currentTarget.files?.[0])}
                    className="sr-only"
                  />
                </label>
              )}
            </div>
          ) : null}

          <div className="mt-2 flex items-center justify-end gap-3">
            <span
              className={`text-xs tabular-nums ${
                overLimit
                  ? "text-danger"
                  : remaining <= 40
                    ? "text-warn"
                    : "text-ink-faint"
              }`}
            >
              {content.length} / {MAX_POST_LENGTH}
            </span>

            {submitting ? <Spinner size="sm" /> : null}

            {onCancel ? (
              <button
                type="button"
                onClick={onCancel}
                className="rounded-full border border-line px-3 py-1 text-xs text-ink-muted transition hover:border-line-strong hover:text-ink"
              >
                キャンセル
              </button>
            ) : null}

            <button
              type="submit"
              disabled={!canSubmit}
              className={`rounded-full bg-accent-strong font-semibold text-white transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 ${
                compact ? "px-4 py-1 text-xs" : "px-5 py-1.5 text-sm"
              }`}
            >
              {scope?.mode === "reply"
                ? "返信する"
                : scope?.mode === "quote"
                  ? "リポストする"
                  : "投稿する"}
            </button>
          </div>

          {!compact ? (
            <p className="mt-2 text-right text-[11px] text-ink-faint">
              ⌘/Ctrl + Enter で投稿
            </p>
          ) : null}
        </div>
      </div>

      {disabled && disabledReason ? (
        <p className="mt-3 rounded-xl border border-line bg-surface-raised px-3 py-2 text-xs text-ink-muted">
          {disabledReason}
        </p>
      ) : null}

      {error ? (
        <div className="mt-3">
          <ErrorBanner
            message="投稿できませんでした"
            detail={error}
            onDismiss={() => {
              setError(null);
            }}
          />
        </div>
      ) : null}
    </form>
  );
}
