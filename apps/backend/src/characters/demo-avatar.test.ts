import { describe, expect, it } from "vitest";
import { DEMO_AVATAR_COUNT, demoAvatarDataUrl } from "./demo-avatar.js";

describe("demo avatar pool", () => {
  it("loads all bundled portraits as distinct JPEG data URLs", () => {
    const avatars = Array.from({ length: DEMO_AVATAR_COUNT }, (_, index) =>
      demoAvatarDataUrl(index),
    );

    expect(avatars).toHaveLength(144);
    expect(new Set(avatars).size).toBe(144);
    expect(avatars.every((avatar) => avatar.startsWith("data:image/jpeg;base64,"))).toBe(
      true,
    );
  });

  it("wraps indices around the portrait pool", () => {
    expect(demoAvatarDataUrl(DEMO_AVATAR_COUNT)).toBe(demoAvatarDataUrl(0));
    expect(demoAvatarDataUrl(-1)).toBe(demoAvatarDataUrl(DEMO_AVATAR_COUNT - 1));
  });
});
