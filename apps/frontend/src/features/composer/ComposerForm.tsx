import { useRef, useState } from "react";
import type { RefObject } from "react";
import { MAX_IMAGE_BYTES, MAX_POST_LENGTH } from "@brickr/shared";
import type { CreatePostRequest, FeedThreadDto, PostDto, UserProfileDto } from "@brickr/shared";

import { Avatar } from "../../components/Avatar";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Icon } from "../../components/Icon";
import { Spinner } from "../../components/Spinner";
import { api, isUnauthorizedError, toErrorMessage } from "../../services/api-client";
import type { ComposerContext } from "../../types";
import { QuotePost } from "../timeline/QuotePost";
import { initialComposerContent } from "./composer-utils";
import { MentionInput } from "./MentionInput";

const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export type ComposerFormProps = {
  context: ComposerContext;
  userProfile: UserProfileDto;
  disabled?: boolean;
  disabledReason?: string;
  onPosted: (post: PostDto, thread: FeedThreadDto) => void;
  /** The session expired mid-compose (§66.11): hand back to the auth-intent flow instead of losing the draft's destination. */
  onUnauthorized: () => void;
  onSubmittingChange?: (submitting: boolean) => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
};

/**
 * The composer's body (§17.2): avatar, textarea, image attach, character
 * count, submit — split out from `ComposerDialog`'s modal chrome (Issue #50
 * / "Composer logic/view分離") so the form itself has no opinion on how it is
 * framed.
 */
export function ComposerForm({
  context,
  userProfile,
  disabled = false,
  disabledReason,
  onPosted,
  onUnauthorized,
  onSubmittingChange,
  textareaRef,
}: ComposerFormProps) {
  const [content, setContent] = useState(() => initialComposerContent(context, userProfile.id));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const fallbackTextareaRef = useRef<HTMLTextAreaElement>(null);

  const remaining = MAX_POST_LENGTH - content.length;
  const overLimit = remaining < 0;
  const isEmpty = content.trim().length === 0 && imageUrl === null;
  const canSubmit = !disabled && !submitting && !isEmpty && !overLimit;

  const submit = async (): Promise<void> => {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    onSubmittingChange?.(true);
    setError(null);

    // `responderIds` still exists in the API, but the UI no longer populates it:
    // an @mention in the body is the only way to force a specific character.
    const request: CreatePostRequest = {
      content: content.trim(),
      ...(context.mode === "new" && imageUrl ? { imageUrl } : {}),
      ...(context.mode === "reply" ? { replyTo: context.post.id } : {}),
      ...(context.mode === "quote" ? { quoteOf: context.post.id } : {}),
    };

    try {
      const { post, thread } = await api.createPost(context.simulationId, request);
      onPosted(post, thread);
    } catch (cause) {
      if (isUnauthorizedError(cause)) {
        onUnauthorized();
        return;
      }
      setError(toErrorMessage(cause));
    } finally {
      setSubmitting(false);
      onSubmittingChange?.(false);
    }
  };

  const placeholder =
    context.mode === "quote"
      ? "コメントを添えてリポスト…"
      : context.mode === "reply"
        ? "返信を書く…"
        : "いま何が起きてる？　@ でキャストを指名できます";

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
      className="px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex gap-3">
        <Avatar
          handle={userProfile.handle}
          displayName={userProfile.displayName}
          avatarUrl={userProfile.avatarUrl}
          size="md"
        />

        <div className="min-w-0 flex-1">
          {context.mode === "reply" || context.mode === "quote" ? (
            <p className="mb-1.5 text-xs text-ink-faint">
              {context.mode === "reply" ? "返信先" : "リポスト元"}:{" "}
              <span className="text-accent">@{context.post.author.handle}</span>
            </p>
          ) : null}

          <MentionInput
            value={content}
            onChange={setContent}
            disabled={disabled || submitting}
            placeholder={placeholder}
            autoFocus
            inputRef={textareaRef ?? fallbackTextareaRef}
            onSubmit={() => {
              void submit();
            }}
          />

          {context.mode === "quote" ? (
            <QuotePost
              post={{
                id: context.post.id,
                author: context.post.author,
                content: context.post.content,
                ...(context.post.imageUrl ? { imageUrl: context.post.imageUrl } : {}),
                createdAt: context.post.createdAt,
              }}
            />
          ) : null}

          {context.mode === "new" ? (
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
                overLimit ? "text-danger" : remaining <= 40 ? "text-warn" : "text-ink-faint"
              }`}
            >
              {content.length} / {MAX_POST_LENGTH}
            </span>

            {submitting ? <Spinner size="sm" /> : null}

            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-full bg-accent-strong px-5 py-1.5 text-sm font-semibold text-white transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {context.mode === "reply" ? "返信する" : context.mode === "quote" ? "リポストする" : "投稿する"}
            </button>
          </div>

          <p className="mt-2 text-right text-[11px] text-ink-faint">⌘/Ctrl + Enter で投稿</p>
        </div>
      </div>

      {disabled && disabledReason ? (
        <p className="mt-3 rounded-xl border border-line bg-surface-raised px-3 py-2 text-xs text-ink-muted">
          {disabledReason}
        </p>
      ) : null}

      {error ? (
        <div className="mt-3">
          <ErrorBanner message="投稿できませんでした" detail={error} onDismiss={() => setError(null)} />
        </div>
      ) : null}
    </form>
  );
}
