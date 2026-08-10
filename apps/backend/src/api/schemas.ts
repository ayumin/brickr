import {
  MAX_IMAGE_DATA_URL_LENGTH,
  MAX_IMAGE_BYTES,
  MAX_POST_LENGTH,
} from "@enjo/shared";
import { z } from "zod";

/**
 * Request validation at the HTTP boundary (CLAUDE.md §55).
 *
 * Ids are validated as non-empty strings only; existence is checked against the
 * database, which returns a 404 rather than a validation error.
 */

const id = z.string().trim().min(1).max(64);

export const createSimulationSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});

const imageDataUrl = z
  .string()
  .max(MAX_IMAGE_DATA_URL_LENGTH)
  .regex(/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/u)
  .refine((value) => decodedImageSize(value) <= MAX_IMAGE_BYTES, "image exceeds 5 MiB");

function decodedImageSize(dataUrl: string): number {
  const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return Math.floor((encoded.length * 3) / 4) - padding;
}

export const createPostSchema = z
  .object({
    content: z.string().trim().max(MAX_POST_LENGTH),
    imageUrl: imageDataUrl.optional(),
    responderIds: z.array(id).max(20).optional(),
    replyTo: id.optional(),
    quoteOf: id.optional(),
  })
  .superRefine((post, context) => {
    if (post.content.length === 0 && !post.imageUrl) {
      context.addIssue({ code: "custom", message: "content or image is required" });
    }
    if (post.imageUrl && (post.replyTo || post.quoteOf)) {
      context.addIssue({
        code: "custom",
        path: ["imageUrl"],
        message: "images are not allowed on replies or quotes",
      });
    }
  });

const probability = z.number().min(0).max(1);

export const saveCharacterSchema = z.object({
  handle: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{1,32}$/u),
  displayName: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  rolePrompt: z.string().trim().min(1).max(4_000),
  tonePrompt: z.string().trim().min(1).max(4_000),
  dialectPrompt: z.string().trim().max(2_000).optional(),
  interests: z.array(z.string().trim().min(1).max(80)).max(20),
  activityLevel: probability,
  responseProbability: probability,
  replyProbability: probability,
  quoteProbability: probability,
  influence: probability,
  modelProfileId: id,
  avatarUrl: z.string().trim().url().max(2_048).optional(),
});

export const saveUserProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500),
  avatarUrl: z.string().trim().url().max(2_048).optional(),
});

export const idParams = z.object({ id });
