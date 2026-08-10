import { describe, expect, it } from "vitest";
import { calculateCropLayout } from "./avatar-crop";

describe("calculateCropLayout", () => {
  it("cover-fits a landscape image into a square viewport", () => {
    expect(
      calculateCropLayout({
        imageWidth: 800,
        imageHeight: 400,
        viewportSize: 200,
        zoom: 1,
        positionX: 0,
        positionY: 0,
      }),
    ).toEqual({ width: 400, height: 200, left: -100, top: 0, scale: 0.5 });
  });

  it("moves the crop window across the available image area", () => {
    const right = calculateCropLayout({
      imageWidth: 800,
      imageHeight: 400,
      viewportSize: 200,
      zoom: 1,
      positionX: 1,
      positionY: 0,
    });
    expect(right.left).toBe(-200);
  });
});
