import { describe, expect, it } from "vitest";
import { toAnthropicMessage } from "./anthropic-provider.js";
import { toGeminiContent } from "./gemini-provider.js";
import { toOpenAIMessage } from "./openai-provider.js";
import type { LLMMessage } from "./provider.js";

const MESSAGE: LLMMessage = {
  role: "user",
  content: "[添付画像1]を見てください。",
  images: [{ mediaType: "image/png", data: "aGVsbG8=" }],
};

describe("multimodal provider message mapping", () => {
  it("maps an image to an OpenAI image_url content part", () => {
    expect(toOpenAIMessage(MESSAGE)).toEqual({
      role: "user",
      content: [
        { type: "text", text: MESSAGE.content },
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,aGVsbG8=" },
        },
      ],
    });
  });

  it("maps an image to an Anthropic base64 image block", () => {
    expect(toAnthropicMessage(MESSAGE)).toEqual({
      role: "user",
      content: [
        { type: "text", text: MESSAGE.content },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: "aGVsbG8=",
          },
        },
      ],
    });
  });

  it("maps an image to a Gemini inlineData part", () => {
    expect(toGeminiContent(MESSAGE)).toEqual({
      role: "user",
      parts: [
        { text: MESSAGE.content },
        { inlineData: { mimeType: "image/png", data: "aGVsbG8=" } },
      ],
    });
  });
});
