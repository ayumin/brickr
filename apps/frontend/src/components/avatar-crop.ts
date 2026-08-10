export type CropLayout = {
  width: number;
  height: number;
  left: number;
  top: number;
  scale: number;
};

export function calculateCropLayout(input: {
  imageWidth: number;
  imageHeight: number;
  viewportSize: number;
  zoom: number;
  positionX: number;
  positionY: number;
}): CropLayout {
  const { imageWidth, imageHeight, viewportSize, zoom, positionX, positionY } = input;
  const scale = Math.max(viewportSize / imageWidth, viewportSize / imageHeight) * zoom;
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  const overflowX = Math.max(0, width - viewportSize);
  const overflowY = Math.max(0, height - viewportSize);
  return {
    width,
    height,
    left: overflowX === 0 ? 0 : -overflowX / 2 - (positionX * overflowX) / 2,
    top: overflowY === 0 ? 0 : -overflowY / 2 - (positionY * overflowY) / 2,
    scale,
  };
}
