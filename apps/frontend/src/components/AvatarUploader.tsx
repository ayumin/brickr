import { useEffect, useRef, useState } from "react";
import {
  AVATAR_IMAGE_SIZE,
  MAX_AVATAR_IMAGE_BYTES,
  MAX_AVATAR_SOURCE_BYTES,
} from "@brickr/shared";
import { calculateCropLayout } from "./avatar-crop";
import { Icon } from "./Icon";

const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const PREVIEW_SIZE = 260;

type CropSource = {
  url: string;
  image: HTMLImageElement;
};

export function AvatarUploader({
  value,
  onChange,
}: {
  value?: string;
  onChange: (value: string | undefined) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<CropSource | null>(null);
  const [zoom, setZoom] = useState(1);
  const [positionX, setPositionX] = useState(0);
  const [positionY, setPositionY] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (source) URL.revokeObjectURL(source.url);
    };
  }, [source]);

  const closeCropper = (): void => {
    setSource(null);
    setProcessing(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const chooseFile = (file: File | undefined): void => {
    if (!file) return;
    setError(null);
    if (!ACCEPTED_TYPES.has(file.type)) {
      setError("PNG、JPEG、GIF、WebP形式の画像を選択してください。");
      return;
    }
    if (file.size > MAX_AVATAR_SOURCE_BYTES) {
      setError("元画像は10MB以下にしてください。");
      return;
    }

    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      setZoom(1);
      setPositionX(0);
      setPositionY(0);
      setSource({ url, image });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setError("画像を読み込めませんでした。");
    };
    image.src = url;
  };

  const applyCrop = async (): Promise<void> => {
    if (!source) return;
    setProcessing(true);
    setError(null);
    try {
      const dataUrl = await renderCroppedAvatar(source.image, zoom, positionX, positionY);
      onChange(dataUrl);
      closeCropper();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "画像を切り取れませんでした。");
      setProcessing(false);
    }
  };

  const layout = source
    ? calculateCropLayout({
        imageWidth: source.image.naturalWidth,
        imageHeight: source.image.naturalHeight,
        viewportSize: PREVIEW_SIZE,
        zoom,
        positionX,
        positionY,
      })
    : null;

  return (
    <div className="space-y-2">
      <p className="text-sm text-ink-muted">アバター画像（任意）</p>
      <div className="flex items-center gap-4 rounded-xl border border-line bg-surface-raised p-3">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-surface text-2xl text-ink-faint">
          {value ? (
            <img src={value} alt="アバターのプレビュー" className="h-full w-full object-cover" />
          ) : (
            <Icon name="person-bounding-box" />
          )}
        </div>
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="rounded-full bg-accent-strong px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent"
            >
              <Icon name="upload" className="mr-1" />
              画像を選択
            </button>
            {value ? (
              <button
                type="button"
                onClick={() => onChange(undefined)}
                className="rounded-full border border-line px-3 py-1.5 text-xs text-ink-muted hover:border-danger/50 hover:text-danger"
              >
                <Icon name="trash" className="mr-1" />
                削除
              </button>
            ) : null}
          </div>
          <p className="text-xs text-ink-faint">選択後に正方形の範囲を調整します。最大10MB。</p>
          {error ? <p className="text-xs text-danger">{error}</p> : null}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="sr-only"
          onChange={(event) => chooseFile(event.currentTarget.files?.[0])}
        />
      </div>

      {source && layout ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm"
          onClick={(event) => {
            if (event.target === event.currentTarget && !processing) closeCropper();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="avatar-crop-title"
            className="w-full max-w-md rounded-2xl border border-line bg-canvas p-5 shadow-2xl"
          >
            <header className="flex items-center gap-3">
              <div>
                <h3 id="avatar-crop-title" className="font-bold text-ink">画像を正方形に切り取る</h3>
                <p className="text-xs text-ink-faint">表示位置と拡大率を調整してください</p>
              </div>
              <button
                type="button"
                onClick={closeCropper}
                aria-label="切り取りをキャンセル"
                className="ml-auto flex h-8 w-8 items-center justify-center rounded-full border border-line text-ink-muted hover:text-ink"
              >
                <Icon name="x-lg" />
              </button>
            </header>

            <div
              className="relative mx-auto mt-4 overflow-hidden rounded-xl bg-black"
              style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }}
            >
              <img
                src={source.url}
                alt="切り取り範囲のプレビュー"
                className="pointer-events-none absolute max-w-none select-none"
                style={{
                  width: layout.width,
                  height: layout.height,
                  left: layout.left,
                  top: layout.top,
                }}
              />
              <div className="pointer-events-none absolute inset-0 border-2 border-white/90" />
            </div>

            <div className="mt-5 space-y-3">
              <CropRange label="拡大" min={1} max={3} step={0.01} value={zoom} onChange={setZoom} />
              <CropRange label="横位置" min={-1} max={1} step={0.01} value={positionX} onChange={setPositionX} />
              <CropRange label="縦位置" min={-1} max={1} step={0.01} value={positionY} onChange={setPositionY} />
            </div>

            <div className="mt-5 flex justify-end gap-3 border-t border-line pt-4">
              <button type="button" onClick={closeCropper} className="rounded-full border border-line px-4 py-2 text-sm text-ink-muted hover:text-ink">
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => void applyCrop()}
                disabled={processing}
                className="rounded-full bg-accent-strong px-5 py-2 text-sm font-semibold text-white hover:bg-accent disabled:opacity-50"
              >
                {processing ? "処理中…" : "この範囲を使用"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CropRange({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid grid-cols-[4rem_1fr] items-center gap-3 text-sm text-ink-muted">
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        className="w-full accent-accent"
      />
    </label>
  );
}

async function renderCroppedAvatar(
  image: HTMLImageElement,
  zoom: number,
  positionX: number,
  positionY: number,
): Promise<string> {
  const layout = calculateCropLayout({
    imageWidth: image.naturalWidth,
    imageHeight: image.naturalHeight,
    viewportSize: PREVIEW_SIZE,
    zoom,
    positionX,
    positionY,
  });
  const sourceX = -layout.left / layout.scale;
  const sourceY = -layout.top / layout.scale;
  const sourceSize = PREVIEW_SIZE / layout.scale;
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_IMAGE_SIZE;
  canvas.height = AVATAR_IMAGE_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("画像処理を開始できませんでした。");
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceSize,
    sourceSize,
    0,
    0,
    AVATAR_IMAGE_SIZE,
    AVATAR_IMAGE_SIZE,
  );

  const blob = await canvasToBlob(canvas);
  if (blob.size > MAX_AVATAR_IMAGE_BYTES) {
    throw new Error("切り取り後の画像が1MBを超えました。別の画像を選択してください。");
  }
  return blobToDataUrl(blob);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("画像を変換できませんでした。"))),
      "image/webp",
      0.9,
    );
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("画像を保存形式に変換できませんでした。"));
    reader.onerror = () => reject(new Error("画像を保存形式に変換できませんでした。"));
    reader.readAsDataURL(blob);
  });
}
